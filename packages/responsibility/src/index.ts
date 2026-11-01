import { Schema } from "effect";
import { parseMinorUnits } from "@awc/contracts";

export const DataClassification = Schema.Literals(["public", "internal", "confidential"]);
export type DataClassification = typeof DataClassification.Type;
export const ActionRisk = Schema.Literals(["observe", "plan", "commercial", "operational", "physical-control", "safety-critical"]);
export type ActionRisk = typeof ActionRisk.Type;

export const Obligation = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("metric"),
    id: Schema.String,
    metric: Schema.String,
    comparator: Schema.Literals([">=", "<=", "="]),
    target: Schema.Number,
    windowSeconds: Schema.Number,
    observationSourceId: Schema.String,
  }),
  Schema.Struct({
    kind: Schema.Literal("process"),
    id: Schema.String,
    action: Schema.String,
    requiredWithinSeconds: Schema.Number,
  }),
  Schema.Struct({
    kind: Schema.Literal("prohibition"),
    id: Schema.String,
    action: Schema.String,
  }),
]);
export type Obligation = typeof Obligation.Type;

/** Describes governance, not permission to call arbitrary physical device APIs. */
export const OperatingMandate = Schema.Struct({
  schemaVersion: Schema.Literal("awc.operating-mandate/v1"),
  id: Schema.String,
  principalId: Schema.String,
  delegateId: Schema.String,
  accountablePartyId: Schema.String,
  operationId: Schema.String,
  issuerId: Schema.String,
  agreementRef: Schema.optionalKey(Schema.String),
  parentId: Schema.optionalKey(Schema.String),
  issuedAt: Schema.String,
  validFrom: Schema.String,
  expiresAt: Schema.String,
  scope: Schema.Struct({
    entityIds: Schema.Array(Schema.String),
    actions: Schema.Array(Schema.String),
    maximumRisk: ActionRisk,
    maximumDataClassification: DataClassification,
    /** Denials are inherited, including where they were omitted from a child allowlist. */
    deniedActions: Schema.Array(Schema.String),
    approvalActions: Schema.Array(Schema.String),
    maximumObservationAgeMs: Schema.Number,
    remainingDelegations: Schema.Number,
  }),
  economics: Schema.Struct({
    accountId: Schema.String,
    currency: Schema.String,
    maxTotalMinor: Schema.String,
    maxPerActionMinor: Schema.String,
  }),
  obligations: Schema.Array(Obligation),
});
export type OperatingMandate = typeof OperatingMandate.Type;

export const ActionProposal = Schema.Struct({
  schemaVersion: Schema.Literal("awc.action/v1"),
  id: Schema.String,
  revision: Schema.String,
  mandateId: Schema.String,
  operationId: Schema.String,
  actorId: Schema.String,
  entityId: Schema.String,
  action: Schema.String,
  risk: ActionRisk,
  dataClassification: DataClassification,
  requestedAt: Schema.String,
  effects: Schema.Array(Schema.String),
  expectedStateVersion: Schema.optionalKey(Schema.String),
  commitment: Schema.optionalKey(Schema.Struct({
    accountId: Schema.String,
    currency: Schema.String,
    maximumMinor: Schema.String,
    pricingReference: Schema.String,
  })),
});
export type ActionProposal = typeof ActionProposal.Type;

/** This is from a trusted asset-owner authorization store, not model-supplied arguments. */
export interface ActionPolicy {
  readonly entityId:string;
  readonly action:string;
  readonly risk:ActionRisk;
  readonly allowedEffects:readonly string[];
}
export interface OwnerPermission {
  readonly ownerId: string;
  readonly granteePrincipalId: string;
  readonly entityId: string;
  readonly actions: readonly string[];
  readonly validUntil: string;
}
export interface TrustedObservation {
  readonly entityId: string;
  readonly stateVersion: string;
  readonly observedAt: string;
  readonly sourceId: string;
}
export interface IndependentApproval {
  readonly approverId: string;
  readonly proposalId: string;
  readonly revision: string;
  readonly validUntil: string;
}
export interface PolicyContext {
  readonly now: string;
  readonly mandates: readonly OperatingMandate[];
  readonly revokedMandateIds: readonly string[];
  readonly ownerPermissions: readonly OwnerPermission[];
  readonly assetOwnerId: string;
  readonly actionPolicies: readonly ActionPolicy[];
  readonly observation?: TrustedObservation;
  readonly approvals: readonly IndependentApproval[];
}
export type PolicyDecision =
 | {readonly kind:"deny";readonly reasonCodes:readonly string[];readonly mandateChain:readonly string[]}
 | {readonly kind:"escalate";readonly reasonCodes:readonly string[];readonly requiredApprovers:readonly string[];readonly mandateChain:readonly string[]}
 | {readonly kind:"permit"|"permit-with-conditions";readonly reasonCodes:readonly string[];readonly mandateChain:readonly string[];readonly validUntil:string};

export class ResponsibilityError extends Error {
  readonly _tag = "ResponsibilityError";
  constructor(readonly code:"invalid_mandate"|"invalid_proposal"|"not_found"|"unauthorized"|"conflict",message:string){
    super(message);
    this.name = "ResponsibilityError";
  }
}
export const decodeMandate = Schema.decodeUnknownSync(OperatingMandate);
export const decodeProposal = Schema.decodeUnknownSync(ActionProposal);
const classification = ["public","internal","confidential"] as const;
const riskOrder = ["observe","plan","commercial","operational","physical-control","safety-critical"] as const;
const date=(value:string):number => {
  const ms=Date.parse(value);
  if(!Number.isFinite(ms) || !/Z$|[+-]\d\d:\d\d$/.test(value)){
    throw new ResponsibilityError("invalid_mandate","Invalid offset-aware timestamp");
  }
  return ms;
};
const subset=(a:readonly string[],b:readonly string[])=>a.every(v=>b.includes(v));
export const money=(value:string):bigint => {
  try{return parseMinorUnits(value);}catch{throw new ResponsibilityError("invalid_mandate","Invalid nonnegative minor-unit amount");}
};

export function assertMandateValid(m:OperatingMandate):void{
  if(!m.id||!m.principalId||!m.delegateId||!m.accountablePartyId||!m.operationId||!m.issuerId||
    !m.economics.accountId || !/^[A-Z]{3}$/.test(m.economics.currency) ||
    date(m.validFrom)>=date(m.expiresAt) || date(m.issuedAt)>date(m.expiresAt) ||
    m.scope.entityIds.length===0 || m.scope.actions.length===0 ||
    !Number.isSafeInteger(m.scope.remainingDelegations) || m.scope.remainingDelegations<0 ||
    !Number.isSafeInteger(m.scope.maximumObservationAgeMs) || m.scope.maximumObservationAgeMs<0 ||
    money(m.economics.maxPerActionMinor)>money(m.economics.maxTotalMinor) ||
    m.scope.actions.some(v=>m.scope.deniedActions.includes(v))) {
      throw new ResponsibilityError("invalid_mandate","Inconsistent identity, limits or scope");
  }
  for(const o of m.obligations){
    if(!o.id)throw new ResponsibilityError("invalid_mandate","Obligation needs an identity");
    if(o.kind==="metric" && (!Number.isFinite(o.target)||!Number.isFinite(o.windowSeconds)||o.windowSeconds<=0)) {
      throw new ResponsibilityError("invalid_mandate","Invalid metric objective");
    }
    if(o.kind==="process"&&(!Number.isFinite(o.requiredWithinSeconds)||o.requiredWithinSeconds<=0)){
      throw new ResponsibilityError("invalid_mandate","Invalid process response time");
    }
  }
}
export function assertAttenuated(child:OperatingMandate,parent:OperatingMandate):void{
  assertMandateValid(child);assertMandateValid(parent);
  if(child.parentId!==parent.id || child.issuerId!==parent.delegateId ||
    child.principalId!==parent.principalId ||
    child.accountablePartyId!==parent.accountablePartyId ||
    child.operationId!==parent.operationId ||
    child.economics.accountId!==parent.economics.accountId ||
    child.economics.currency!==parent.economics.currency ||
    !subset(child.scope.entityIds,parent.scope.entityIds) ||
    !subset(child.scope.actions,parent.scope.actions) ||
    !subset(parent.scope.deniedActions,child.scope.deniedActions) ||
    !subset(parent.scope.approvalActions.filter(a=>child.scope.actions.includes(a)),child.scope.approvalActions) ||
    classification.indexOf(child.scope.maximumDataClassification)>
      classification.indexOf(parent.scope.maximumDataClassification) ||
    riskOrder.indexOf(child.scope.maximumRisk)>riskOrder.indexOf(parent.scope.maximumRisk) ||
    child.scope.maximumObservationAgeMs>parent.scope.maximumObservationAgeMs ||
    parent.scope.remainingDelegations<1 ||
    child.scope.remainingDelegations>=parent.scope.remainingDelegations ||
    date(child.validFrom)<date(parent.validFrom) ||
    date(child.expiresAt)>date(parent.expiresAt) ||
    money(child.economics.maxTotalMinor)>money(parent.economics.maxTotalMinor) ||
    money(child.economics.maxPerActionMinor)>money(parent.economics.maxPerActionMinor)){
      throw new ResponsibilityError("invalid_mandate","Submandate enlarges authority or breaks delegation chain");
  }
}

/** Deterministic, explicitly ordered payload used to bind an action revision to all terms.
 * Reference canonicalization only; this is NOT a cross-language signing standard. */
export function canonicalActionProposal(p:ActionProposal):string{
 return JSON.stringify({
  schemaVersion:p.schemaVersion,id:p.id,mandateId:p.mandateId,
  operationId:p.operationId,actorId:p.actorId,entityId:p.entityId,
  action:p.action,risk:p.risk,dataClassification:p.dataClassification,
  requestedAt:p.requestedAt,effects:[...p.effects],
  expectedStateVersion:p.expectedStateVersion??null,
  commitment:p.commitment?{
   accountId:p.commitment.accountId,currency:p.commitment.currency,
   maximumMinor:p.commitment.maximumMinor,pricingReference:p.commitment.pricingReference,
  }:null,
 });
}
export async function computeActionRevision(p:ActionProposal):Promise<string>{
 const data=new TextEncoder().encode(canonicalActionProposal(p));
 const digest=await crypto.subtle.digest("SHA-256",data);
 return Array.from(new Uint8Array(digest),v=>v.toString(16).padStart(2,"0")).join("");
}
export async function sealActionProposal(p:ActionProposal):Promise<ActionProposal>{
 return {...p,revision:await computeActionRevision(p)};
}
export async function assertActionRevision(p:ActionProposal):Promise<void>{
 if(p.revision!==await computeActionRevision(p)){
  throw new ResponsibilityError("invalid_proposal","Proposal revision does not bind to exact action terms");
 }
}

/** Caller must supply mandates from an authenticated registry, never agent-provided assertions. */
export function mandateChain(id:string,all:readonly OperatingMandate[]):readonly OperatingMandate[]{
  const byId=new Map<string,OperatingMandate>();
  for(const m of all){
    if(byId.has(m.id))throw new ResponsibilityError("invalid_mandate","Duplicate mandate ID");
    assertMandateValid(m);byId.set(m.id,m);
  }
  const chain:OperatingMandate[]=[];const visited=new Set<string>();let current=byId.get(id);
  if(!current)throw new ResponsibilityError("not_found","Mandate not found");
  while(current){
    if(visited.has(current.id)||chain.length>=32)throw new ResponsibilityError("invalid_mandate","Cyclic or excessively deep mandate chain");
    visited.add(current.id);chain.push(current);
    if(!current.parentId)break;
    const parent=byId.get(current.parentId);
    if(!parent)throw new ResponsibilityError("invalid_mandate","Parent mandate unavailable");
    assertAttenuated(current,parent);
    current=parent;
  }
  return chain;
}
/**
 * Pure preflight. NEVER use this decision alone to execute or spend.
 * Commit must reacquire current authority/asset state and reserve funding atomically.
 */
export function evaluateAction(proposal:ActionProposal,ctx:PolicyContext):PolicyDecision{
  let chain:readonly OperatingMandate[];
  try{chain=mandateChain(proposal.mandateId,ctx.mandates);}catch(e){
    return {kind:"deny",reasonCodes:["MANDATE_CHAIN_INVALID"],mandateChain:[]};
  }
  const ids=chain.map(x=>x.id);
  const root=chain[0]!;
  const reasons:string[]=[];
  const policy=ctx.actionPolicies.find(x=>x.entityId===proposal.entityId&&x.action===proposal.action);
  if(!policy||policy.risk!==proposal.risk||
     proposal.effects.length!==policy.allowedEffects.length ||
     !proposal.effects.every(x=>policy.allowedEffects.includes(x))){
    reasons.push("ACTION_DESCRIPTOR_MISMATCH");
  }
  let now:number;
  try{now=date(ctx.now);date(proposal.requestedAt);}catch{
    return {kind:"deny",reasonCodes:["INVALID_TIME"],mandateChain:ids};
  }
  if(proposal.operationId!==root.operationId || proposal.actorId!==root.delegateId)reasons.push("ACTOR_OR_OPERATION_MISMATCH");
  if(proposal.risk==="physical-control"||proposal.risk==="safety-critical" ||
     /^plc\.|^safety\.|^actuator\./.test(proposal.action))reasons.push("PHYSICAL_CONTROL_NOT_SUPPORTED");
  if(!proposal.id || !/^[0-9a-f]{64}$/.test(proposal.revision))reasons.push("INVALID_PROPOSAL_ID_OR_REVISION");
  for(const m of chain){
    if(ctx.revokedMandateIds.includes(m.id))reasons.push("REVOKED_MANDATE");
    if(now<date(m.validFrom)||now>=date(m.expiresAt))reasons.push("MANDATE_EXPIRED_OR_INACTIVE");
    if(!m.scope.entityIds.includes(proposal.entityId) ||
       !m.scope.actions.includes(proposal.action) ||
       m.scope.deniedActions.includes(proposal.action) ||
       riskOrder.indexOf(proposal.risk)>riskOrder.indexOf(m.scope.maximumRisk) ||
       classification.indexOf(proposal.dataClassification)>
         classification.indexOf(m.scope.maximumDataClassification))reasons.push("SCOPE_DENIED");
  }
  const owner=ctx.ownerPermissions.some(g=>g.ownerId===ctx.assetOwnerId &&
    g.granteePrincipalId===root.principalId &&
    g.entityId===proposal.entityId && g.actions.includes(proposal.action) && date(g.validUntil)>now);
  if(!owner)reasons.push("ASSET_OWNER_PERMISSION_MISSING");
  const write=policy?.risk==="commercial"||policy?.risk==="operational";
  if(write){
    const observation=ctx.observation;
    if(!observation || !proposal.expectedStateVersion ||
       observation.entityId!==proposal.entityId ||
       observation.stateVersion!==proposal.expectedStateVersion ||
       date(observation.observedAt)>now ||
       chain.some(m=>now-date(observation.observedAt)>m.scope.maximumObservationAgeMs)){
      reasons.push("STALE_OR_MISMATCHED_OBSERVATION");
    }
  }
  if(policy?.risk==="commercial"&&!proposal.commitment)reasons.push("UNBOUNDED_COMMERCIAL_ACTION");
  if(proposal.commitment){
    const c=proposal.commitment;
    if(!c.pricingReference || money(c.maximumMinor)<=0n || chain.some(m=>
      c.accountId!==m.economics.accountId ||
      c.currency!==m.economics.currency ||
      money(c.maximumMinor)>money(m.economics.maxPerActionMinor)
    ))reasons.push("FINANCIAL_SCOPE_DENIED");
  }
  if(reasons.length) return {kind:"deny",reasonCodes:[...new Set(reasons)],mandateChain:ids};
  const required=[...new Set(chain.flatMap(m=>m.scope.approvalActions.includes(proposal.action)?[m.principalId]:[]))];
  const approved=ctx.approvals.some(a=>required.includes(a.approverId)&&
    a.proposalId===proposal.id && a.revision===proposal.revision && date(a.validUntil)>now);
  if(required.length&&!approved) return {kind:"escalate",reasonCodes:["INDEPENDENT_APPROVAL_REQUIRED"],requiredApprovers:required,mandateChain:ids};
  return {kind:write?"permit-with-conditions":"permit",
    reasonCodes:write?["REVALIDATE_STATE_AND_BUDGET_AT_COMMIT"]:[],
    mandateChain:ids,validUntil:new Date(Math.min(...chain.map(m=>date(m.expiresAt)),now+60_000)).toISOString()};
}
