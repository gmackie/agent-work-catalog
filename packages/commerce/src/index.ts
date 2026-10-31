import { Context, Effect, Layer } from "effect";
import type { WorkResult } from "@awc/contracts";
import { MarketplaceError, type Marketplace, type PreparedWork, type Quote } from "@awc/marketplace";

/**
 * Explicitly separate signed commercial agreement, funding, and execution.
 * No method infers human approval from a chatbot message or an MCP tool call.
 */
export type CommercialStatus =
  | "prepared_unfunded" | "approved" | "checkout_pending" | "funded"
  | "queued" | "running" | "submitted" | "failed";

export class CommerceError extends Error {
  readonly _tag = "CommerceError";
  constructor(
    readonly code: "not_found" | "invalid_state" | "unauthorized" |
      "funding_required" | "conflict" | "unsupported" | "unavailable",
    message: string,
  ) { super(message); this.name = "CommerceError"; }
}

export interface ApprovalEvidence {
  readonly approverSubject: string;
  readonly buyerId: string;
  readonly reviewedDigest: string;
  /** Verifier of separate human-facing identity ceremony, never an agent claim. */
  readonly ceremony: "interactive-oidc" | "local-sandbox-only";
}
export interface VerifiedFunding {
  readonly rail: "stripe-test" | "sandbox";
  readonly reference: string;
  readonly buyerId: string;
  readonly workId: string;
  readonly quoteDigest: string;
  readonly currency: string;
  readonly minorUnits: string;
  readonly observedAt: string;
}
export interface CheckoutDetails {
  readonly sessionId: string;
  readonly url: string;
}
export interface CheckoutRail {
  readonly create: (work: PreparedWork, quote: Quote) => Promise<CheckoutDetails>;
  readonly verify: (sessionId: string, work: PreparedWork, quote: Quote) => Promise<VerifiedFunding>;
}
export interface WorkSnapshot {
  readonly id: string;
  readonly buyerId: string;
  readonly quoteDigest: string;
  readonly status: CommercialStatus;
  readonly version: number;
  readonly attempts: number;
  readonly updatedAt: string;
  readonly approvedBy?: string | undefined;
  readonly approvalCeremony?: ApprovalEvidence["ceremony"] | undefined;
  readonly paymentReference?: string | undefined;
  readonly paymentRail?: VerifiedFunding["rail"] | undefined;
  readonly checkoutSessionId?: string | undefined;
  readonly checkoutUrl?: string | undefined;
  readonly executionToken?: string | undefined;
  readonly leaseUntil?: number | undefined;
  readonly result?: WorkResult | undefined;
  readonly lastError?: string | undefined;
}
export type WorkRunMessage = { readonly workId: string; readonly buyerId: string };
export interface WorkStateStore {
  readonly initialize: (work: PreparedWork, now: string) => Promise<WorkSnapshot>;
  readonly get: (buyerId: string, id: string) => Promise<WorkSnapshot | undefined>;
  /** Compare-and-swap must be atomic with respect to status/version. */
  readonly cas: (before: WorkSnapshot, after: WorkSnapshot) => Promise<boolean>;
  readonly recoverable: (now: number, limit: number) => Promise<readonly WorkRunMessage[]>;
}
export interface WorkExecutor {
  readonly execute: (work: PreparedWork, quote: Quote) => Promise<WorkResult>;
}

export interface Commerce {
  readonly preview: (buyerId: string, workId: string) => Effect.Effect<{work: PreparedWork;quote: Quote;state: WorkSnapshot}, CommerceError>;
  readonly approve: (buyerId: string, workId: string, proof: ApprovalEvidence) => Effect.Effect<WorkSnapshot, CommerceError>;
  readonly checkout: (buyerId: string, workId: string) => Effect.Effect<{url:string;state:WorkSnapshot}, CommerceError>;
  readonly reconcileStripe: (buyerId: string, workId: string) => Effect.Effect<WorkSnapshot, CommerceError>;
  /** Restricted to a locally enabled sandbox administrative route; NEVER an MCP tool. */
  readonly sandboxFund: (buyerId: string, workId: string) => Effect.Effect<WorkSnapshot, CommerceError>;
  readonly start: (buyerId: string, workId: string) => Effect.Effect<{state:WorkSnapshot;enqueue:boolean}, CommerceError>;
  readonly runQueued: (message: WorkRunMessage) => Effect.Effect<WorkSnapshot, CommerceError>;
  readonly recoverable: () => Effect.Effect<readonly WorkRunMessage[], CommerceError>;
}
export class CommerceService extends Context.Service<CommerceService, Commerce>()("@awc/CommerceService") {}
const err = (unknown: unknown): CommerceError =>
  unknown instanceof CommerceError ? unknown :
  unknown instanceof MarketplaceError ? new CommerceError(unknown.code === "not_found" ? "not_found":"unavailable", unknown.message) :
  new CommerceError("unavailable", "Commercial operation could not be completed");

export function makeCommerce(
  marketplace: Marketplace,
  store: WorkStateStore,
  executor: WorkExecutor,
  options: {readonly now?: () => number;readonly checkout?: CheckoutRail;readonly enableSandboxFunding?: boolean} = {},
): Commerce {
  const now = options.now ?? Date.now;
  const load = async (buyerId: string, workId: string) => {
    const work = await Effect.runPromise(marketplace.getWork(buyerId, workId));
    const quote = await Effect.runPromise(marketplace.getQuote(buyerId, work.quoteId));
    if (quote.termsDigest !== work.quoteDigest || quote.buyerId !== buyerId ||
        quote.offeringId !== work.offeringId || quote.taskTypeId !== work.taskTypeId ||
        quote.price.minorUnits !== work.funding.amount.minorUnits ||
        quote.price.currency !== work.funding.amount.currency) {
      throw new CommerceError("conflict", "Contract commitments do not match stored quote");
    }
    const state = await store.initialize(work, new Date(now()).toISOString());
    if (state.quoteDigest !== work.quoteDigest || state.buyerId !== buyerId) {
      throw new CommerceError("conflict", "Work state does not bind to this agreement");
    }
    return { work, quote, state };
  };
  const change = async (before: WorkSnapshot, patch: Partial<WorkSnapshot>): Promise<WorkSnapshot> => {
    const next: WorkSnapshot = { ...before, ...patch, version: before.version + 1, updatedAt: new Date(now()).toISOString() };
    if (!(await store.cas(before, next))) {
      throw new CommerceError("conflict", "Work state changed concurrently; refresh before retrying");
    }
    return next;
  };
  const verified = async (buyerId:string,workId:string,proof:VerifiedFunding) => {
    const {work,quote,state}=await load(buyerId,workId);
    if (state.paymentReference === proof.reference && state.paymentRail===proof.rail &&
        ["funded","queued","running","submitted","failed"].includes(state.status)) return state;
    if (!(state.status === "approved" || state.status === "checkout_pending")) {
      throw new CommerceError("invalid_state","Approval required before funding");
    }
    if (proof.buyerId !== buyerId || proof.workId !== workId || proof.quoteDigest !== quote.termsDigest ||
      proof.currency !== quote.price.currency || proof.minorUnits !== quote.price.minorUnits ||
      !proof.reference || !Number.isFinite(Date.parse(proof.observedAt))) {
      throw new CommerceError("funding_required","Verified funding does not match exact contract");
    }
    if (proof.rail === "stripe-test" && (state.status !== "checkout_pending" ||
      state.checkoutSessionId !== proof.reference)) throw new CommerceError("funding_required","Checkout session mismatch");
    if (proof.rail === "sandbox" && (!options.enableSandboxFunding || state.status !== "approved")) {
      throw new CommerceError("funding_required","Sandbox funding disabled");
    }
    return change(state,{status:"funded",paymentReference:proof.reference,paymentRail:proof.rail});
  };
  const attempt = <T>(fn:()=>Promise<T>):Effect.Effect<T,CommerceError> =>
    Effect.tryPromise({try:fn,catch:err});
  return {
    preview: (buyerId,workId)=>attempt(()=>load(buyerId,workId)),
    approve: (buyerId,workId,proof)=>attempt(async()=>{
      const {quote,state}=await load(buyerId,workId);
      if (proof.buyerId !== buyerId || proof.reviewedDigest !== quote.termsDigest ||
          !proof.approverSubject.trim()) throw new CommerceError("unauthorized","Approval identity or terms mismatch");
      if (state.status === "approved" && state.approvedBy === proof.approverSubject) return state;
      if (state.status !== "prepared_unfunded") throw new CommerceError("invalid_state","Approval is already committed or work has progressed");
      if (Date.parse(quote.expiresAt) <= now()) throw new CommerceError("invalid_state","Quotation expired");
      return change(state,{status:"approved",approvedBy:proof.approverSubject,approvalCeremony:proof.ceremony});
    }),
    checkout: (buyerId,workId)=>attempt(async()=>{
      const {work,quote,state}=await load(buyerId,workId);
      if (!options.checkout) throw new CommerceError("unsupported","Stripe checkout not configured");
      if (state.status==="checkout_pending" && state.checkoutUrl) return {url:state.checkoutUrl,state};
      if (state.status !== "approved") throw new CommerceError("invalid_state","Human approval required before checkout");
      const created=await options.checkout.create(work,quote);
      if (!created.sessionId.startsWith("cs_") || new URL(created.url).protocol!=="https:") {
        throw new CommerceError("unavailable","Payment provider returned invalid checkout");
      }
      const updated=await change(state,{status:"checkout_pending",checkoutSessionId:created.sessionId,checkoutUrl:created.url});
      return {url:created.url,state:updated};
    }),
    reconcileStripe: (buyerId,workId)=>attempt(async()=>{
      if (!options.checkout) throw new CommerceError("unsupported","Stripe funding not configured");
      const {work,quote,state}=await load(buyerId,workId);
      if (state.paymentRail==="stripe-test" && state.paymentReference===state.checkoutSessionId &&
          ["funded","queued","running","submitted","failed"].includes(state.status)) return state;
      if (state.status!=="checkout_pending"||!state.checkoutSessionId) {
        throw new CommerceError("invalid_state","No bound Checkout Session");
      }
      const proof=await options.checkout.verify(state.checkoutSessionId,work,quote);
      return verified(buyerId,workId,proof);
    }),
    sandboxFund: (buyerId,workId)=>attempt(async()=>{
      if (!options.enableSandboxFunding) throw new CommerceError("unauthorized","Sandbox funding disabled");
      const {quote}=await load(buyerId,workId);
      return verified(buyerId,workId,{
        rail:"sandbox",reference:"local-sandbox:"+workId,buyerId,workId,quoteDigest:quote.termsDigest,
        currency:quote.price.currency,minorUnits:quote.price.minorUnits,observedAt:new Date(now()).toISOString(),
      });
    }),
    start: (buyerId,workId)=>attempt(async()=>{
      const {state}=await load(buyerId,workId);
      if (state.status==="queued"||state.status==="running"||state.status==="submitted") {
        return {state,enqueue:false};
      }
      if (state.status!=="funded") throw new CommerceError("funding_required","No matching verified funding");
      return {state:await change(state,{status:"queued"}),enqueue:true};
    }),
    runQueued: (message)=>attempt(async()=>{
      const {work,quote,state}=await load(message.buyerId,message.workId);
      if (state.status==="submitted") return state;
      if (state.status==="failed") throw new CommerceError("invalid_state","Failed execution needs explicit human resolution");
      const reclaimable=state.status==="running" && typeof state.leaseUntil==="number" &&
        state.leaseUntil<now() && state.attempts<3;
      if (state.status!=="queued" && !reclaimable) {
        throw new CommerceError("invalid_state","Work not queued or another execution holds the lease");
      }
      const token=crypto.randomUUID();
      const claimed=await change(state,{status:"running",executionToken:token,leaseUntil:now()+60_000,attempts:state.attempts+1});
      try {
        // Only deterministic, side-effect-free sandbox executor is registered in this slice.
        const result=await executor.execute(work,quote);
        if (result.orderId!==work.id || result.artifacts.length>12 ||
            JSON.stringify(result).length>200_000) throw new CommerceError("unavailable","Worker output rejected");
        // Each CAS includes a lease token, so a stale worker cannot overwrite another attempt.
        return change(claimed,{status:"submitted",result,leaseUntil:undefined,executionToken:undefined});
      } catch(e) {
        await change(claimed,{status:"failed",lastError:"Worker failed or output invalid",leaseUntil:undefined,executionToken:undefined});
        throw e;
      }
    }),
    recoverable: ()=>attempt(()=>store.recoverable(now(),100)),
  };
}
export const commerceLayer = (commerce: Commerce) => Layer.succeed(CommerceService, commerce);

/** Only a deterministic toy worker is permitted while money/provider identities are unverified. */
export const sandboxExecutor: WorkExecutor={
  execute: async (work,quote)=>{
    if (!["task:oauth-security-audit","task:modbus-diagnostics"].includes(work.taskTypeId)) {
      throw new CommerceError("unsupported","No sandbox executor for this task");
    }
    if (work.inputs.some(i=>i.kind!=="inline")) throw new CommerceError("unsupported","Sandbox worker does not fetch artifacts");
    return {
      orderId:work.id,producedAt:new Date().toISOString(),
      summary:"DEMO ONLY: normalized example work for "+quote.offeringId+"; not a real professional assessment",
      artifacts:[{
        name:"example-result.json",mediaType:"application/json",kind:"inline",
        data:{notice:"Synthetic sandbox output; no LLM, no external agent or professional evaluation",taskTypeId:work.taskTypeId, inputNames:work.inputs.map(x=>x.name)},
      }],
    };
  },
};
