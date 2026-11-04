import { Context, Effect, Layer } from "effect";
import { assertArtifactShape, parseMinorUnits, type Money, type Offering, type TaskType, type WorkInput } from "@awc/contracts";

export class MarketplaceError extends Error {
  readonly _tag = "MarketplaceError";
  constructor(
    readonly code: "invalid_request" | "not_found" | "conflict" | "unauthorized" | "unavailable",
    message: string,
  ) {
    super(message);
    this.name = "MarketplaceError";
  }
}

/**
 * Deliberately fictional reference offerings; this is NOT a live provider directory.
 * A production catalog must verify provider ownership and independently confirm claims.
 */
export const seedTaskTypes: readonly TaskType[] = [
  {
    id: "task:oauth-security-audit", version: "1", name: "Audit OAuth and MCP authorization",
    description: "Read-only security review of OAuth, tokens, MCP scopes and tenant boundaries",
    inputMediaTypes: ["text/plain", "application/json"],
    outputMediaTypes: ["application/json", "text/markdown"], permittedEffects: [],
  },
  {
    id: "task:modbus-diagnostics", version: "1", name: "Diagnose Modbus TCP faults",
    description: "Analyze diagnostic observations and return evidence-based network findings",
    inputMediaTypes: ["text/plain", "application/json"],
    outputMediaTypes: ["application/json", "text/markdown"], permittedEffects: [],
  },
  {
    id: "task:expert-chat", version: "1", name: "Specialist engineering chat",
    description: "Metered advisory inference, without a deliverable guarantee",
    inputMediaTypes: ["text/plain"], outputMediaTypes: ["text/plain"], permittedEffects: [],
  },
];

export const seedOfferings: readonly Offering[] = [
  {
    id: "offering:oauth-audit", version: "1", providerId: "example-provider:security",
    taskTypeId: "task:oauth-security-audit", title: "OAuth Security Review (sample)",
    description: "Sample fixed-price security review; structured findings and markdown report",
    pricing: { mode: "fixed", fixedAmount: { currency: "USD", minorUnits: "9000" } },
    execution: [{ protocol: "openai-responses", endpoint: "https://example.invalid/v1/responses" }],
  },
  {
    id: "offering:modbus-report", version: "1", providerId: "example-provider:controls",
    taskTypeId: "task:modbus-diagnostics", title: "Modbus Diagnostic Report (sample)",
    description: "Sample report based on packet observations and PLC/HMI communication symptoms",
    pricing: { mode: "fixed", fixedAmount: { currency: "USD", minorUnits: "3500" } },
    execution: [{ protocol: "openai-responses", endpoint: "https://example.invalid/v1/responses" }],
  },
  {
    id: "offering:expert-inference", version: "1", providerId: "example-provider:controls",
    taskTypeId: "task:expert-chat", title: "Industrial Controls Expert Chat (sample)",
    description: "Usage-metered specialist inference; illustrative 15% premium, not fixed-price",
    pricing: { mode: "metered" },
    execution: [{ protocol: "openai-chat", endpoint: "https://example.invalid/v1/chat/completions" }],
  },
];

export interface SearchRequest {
  readonly intent: string;
  readonly currency?: string | undefined;
  readonly maxPriceMinor?: string | undefined;
  readonly inputMediaType?: string | undefined;
  readonly outputMediaType?: string | undefined;
  readonly limit?: number | undefined;
}
export interface OfferingMatch {
  readonly offering: Offering;
  readonly taskType: TaskType;
  readonly score: number;
  readonly reasons: readonly string[];
}
export interface SearchResult {
  readonly catalog: "seeded-demo-only";
  readonly intent: string;
  readonly matches: readonly OfferingMatch[];
}
export interface Quote {
  readonly id: string;
  readonly buyerId: string;
  readonly offeringId: string;
  readonly offeringVersion: string;
  readonly taskTypeId: string;
  readonly scope: string;
  readonly price: Money;
  readonly requestDigest: string;
  readonly termsDigest: string;
  readonly idempotencyKey: string;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly state: "quoted";
}
export interface PreparedWork {
  readonly id: string;
  readonly buyerId: string;
  readonly quoteId: string;
  readonly offeringId: string;
  readonly taskTypeId: string;
  readonly quoteDigest: string;
  readonly inputDigest: string;
  readonly inputs: readonly WorkInput[];
  readonly idempotencyKey: string;
  readonly state: "prepared_unfunded";
  readonly createdAt: string;
  readonly funding: { readonly status: "not_authorized"; readonly amount: Money };
}
export interface QuoteRequest {
  readonly offeringId: string;
  readonly scope: string;
  readonly idempotencyKey: string;
  readonly maxPriceMinor?: string | undefined;
}
export interface PrepareRequest {
  readonly quoteId: string;
  readonly inputs: readonly WorkInput[];
  readonly idempotencyKey: string;
}
export interface MarketplaceStore {
  readonly putQuote: (quote: Quote) => Promise<Quote>;
  readonly getQuote: (buyerId: string, id: string) => Promise<Quote | undefined>;
  readonly putWork: (work: PreparedWork) => Promise<PreparedWork>;
  readonly getWork: (buyerId: string, id: string) => Promise<PreparedWork | undefined>;
}
export interface Marketplace {
  readonly search: (input: SearchRequest) => Effect.Effect<SearchResult, MarketplaceError>;
  readonly getOffering: (id: string) => Effect.Effect<OfferingMatch, MarketplaceError>;
  readonly requestQuote: (buyerId: string, request: QuoteRequest) => Effect.Effect<Quote, MarketplaceError>;
  readonly prepareWork: (buyerId: string, request: PrepareRequest) => Effect.Effect<PreparedWork, MarketplaceError>;
  readonly getWork: (buyerId: string, id: string) => Effect.Effect<PreparedWork, MarketplaceError>;
}
export class MarketplaceService extends Context.Service<MarketplaceService, Marketplace>()("@awc/MarketplaceService") {}

const fail = (e: unknown): MarketplaceError =>
  e instanceof MarketplaceError ? e : new MarketplaceError("unavailable", "Marketplace persistence failed");
const sha256 = async (message: string): Promise<string> => {
  const data = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(message));
  return Array.from(new Uint8Array(data), (c) => c.toString(16).padStart(2, "0")).join("");
};
const keyOk = (key: string) => /^[a-zA-Z0-9_-]{8,100}$/.test(key);
const getOffering = (id: string) => {
  const offering = seedOfferings.find((o) => o.id === id);
  if (!offering) throw new MarketplaceError("not_found", "Offering not found");
  const taskType = seedTaskTypes.find((t) => t.id === offering.taskTypeId);
  if (!taskType) throw new MarketplaceError("unavailable", "Offering has no task type");
  return { offering, taskType, score: 0, reasons: [] } satisfies OfferingMatch;
};
const tokens = (text: string) => [...new Set(text.toLowerCase().match(/[a-z0-9]{3,}/g) ?? [])];
const matches = (input: SearchRequest): SearchResult => {
  if (input.intent.length < 3 || input.intent.length > 2000 || (input.limit ?? 10) > 20) {
    throw new MarketplaceError("invalid_request", "Search request exceeds permitted limits");
  }
  const budget = input.maxPriceMinor === undefined ? undefined : parseMinorUnits(input.maxPriceMinor);
  const words = tokens(input.intent);
  const found = seedOfferings.flatMap((offering) => {
    const taskType = seedTaskTypes.find((t) => t.id === offering.taskTypeId);
    if (!taskType) return [];
    if (input.currency && offering.pricing.fixedAmount &&
        input.currency.toUpperCase() !== offering.pricing.fixedAmount.currency) return [];
    if (budget !== undefined && (!offering.pricing.fixedAmount ||
        BigInt(offering.pricing.fixedAmount.minorUnits) > budget)) return [];
    if (input.inputMediaType && !taskType.inputMediaTypes.includes(input.inputMediaType)) return [];
    if (input.outputMediaType && !taskType.outputMediaTypes.includes(input.outputMediaType)) return [];
    const text = [taskType.name, taskType.description, offering.title, offering.description].join(" ").toLowerCase();
    const hits = words.filter((word) => text.includes(word));
    if (hits.length === 0) return [];
    const score = hits.length / Math.max(words.length, 1);
    return [{ offering, taskType, score, reasons: hits.map((word) => "keyword:" + word) }];
  });
  found.sort((a, b) => b.score - a.score || a.offering.id.localeCompare(b.offering.id));
  return { catalog: "seeded-demo-only", intent: input.intent, matches: found.slice(0, input.limit ?? 10) };
};

export function makeMarketplace(store: MarketplaceStore, now: () => number = Date.now): Marketplace {
  return {
    search: (input) => Effect.try({
      try: () => matches(input),
      catch: (error) => error instanceof MarketplaceError ? error :
        new MarketplaceError("invalid_request", "Search filters are invalid"),
    }),
    getOffering: (id) => Effect.try({ try: () => getOffering(id), catch: fail }),
    requestQuote: (buyerId, request) => Effect.tryPromise({
      try: async () => {
        if (!buyerId || !keyOk(request.idempotencyKey) || request.scope.trim().length < 8 ||
            request.scope.length > 2000) throw new MarketplaceError("invalid_request", "Quote requirements invalid");
        const { offering, taskType } = getOffering(request.offeringId);
        if (offering.pricing.mode !== "fixed" || !offering.pricing.fixedAmount) {
          throw new MarketplaceError("invalid_request", "Metered offerings require a separate usage quotation");
        }
        if (request.maxPriceMinor !== undefined &&
            parseMinorUnits(request.maxPriceMinor) < parseMinorUnits(offering.pricing.fixedAmount.minorUnits)) {
          throw new MarketplaceError("invalid_request", "Offering exceeds the buyer's stated maximum");
        }
        const scope = request.scope.trim();
        const requestDigest = await sha256(JSON.stringify({
          offeringId: offering.id, version: offering.version, scope, maxPriceMinor: request.maxPriceMinor ?? null,
        }));
        const price = offering.pricing.fixedAmount;
        const createdAt = new Date(now()).toISOString();
        const termsDigest = await sha256(JSON.stringify({
          offeringId: offering.id, offeringVersion: offering.version, taskTypeId: taskType.id,
          scope, price, buyerId, requestDigest,
        }));
        const quote: Quote = {
          id: "quote_" + crypto.randomUUID(), buyerId, offeringId: offering.id,
          offeringVersion: offering.version, taskTypeId: taskType.id, scope, price,
          requestDigest, termsDigest, idempotencyKey: request.idempotencyKey,
          createdAt, expiresAt: new Date(now() + 60 * 60 * 1000).toISOString(), state: "quoted",
        };
        return store.putQuote(quote);
      },
      catch: fail,
    }),
    prepareWork: (buyerId, request) => Effect.tryPromise({
      try: async () => {
        if (!buyerId || !keyOk(request.idempotencyKey) || !Array.isArray(request.inputs) ||
            request.inputs.length === 0 || request.inputs.length > 10) {
          throw new MarketplaceError("invalid_request", "Work inputs or idempotency key invalid");
        }
        const quote = await store.getQuote(buyerId, request.quoteId);
        if (!quote) throw new MarketplaceError("not_found", "Quote not found");
        if (Date.parse(quote.expiresAt) <= now()) throw new MarketplaceError("invalid_request", "Quote expired");
        const { taskType } = getOffering(quote.offeringId);
        for (const input of request.inputs) {
          assertArtifactShape(input);
          if (!taskType.inputMediaTypes.includes(input.mediaType)) {
            throw new MarketplaceError("invalid_request", "Input media type not supported");
          }
        }
        const serialized = JSON.stringify(request.inputs);
        if (serialized.length > 24_000) throw new MarketplaceError("invalid_request", "Input payload too large");
        const inputDigest = await sha256(serialized);
        const work: PreparedWork = {
          id: "work_" + crypto.randomUUID(), buyerId, quoteId: quote.id,
          taskTypeId: quote.taskTypeId, offeringId: quote.offeringId,
          quoteDigest: quote.termsDigest, inputDigest, inputs: request.inputs,
          idempotencyKey: request.idempotencyKey, state: "prepared_unfunded",
          createdAt: new Date(now()).toISOString(),
          funding: { status: "not_authorized", amount: quote.price },
        };
        return store.putWork(work);
      },
      catch: (error) => error instanceof MarketplaceError ? error :
        new MarketplaceError("invalid_request", "Work inputs were rejected"),
    }),
    getWork: (buyerId, id) => Effect.tryPromise({
      try: async () => {
        const work = await store.getWork(buyerId, id);
        if (!work) throw new MarketplaceError("not_found", "Work order not found");
        return work;
      },
      catch: fail,
    }),
  };
}
export const marketplaceLayer = (store: MarketplaceStore) =>
  Layer.succeed(MarketplaceService, makeMarketplace(store));

/** Test-only storage. No restart recovery or shared idempotency across isolates. */
export function inMemoryMarketplaceStore(): MarketplaceStore {
  const quotes = new Map<string, Quote>();
  const quoteKeys = new Map<string, string>();
  const works = new Map<string, PreparedWork>();
  const workKeys = new Map<string, string>();
  return {
    putQuote: async (quote) => {
      const key = quote.buyerId + ":" + quote.idempotencyKey;
      const prev = quoteKeys.get(key);
      if (prev) {
        const existing = quotes.get(prev)!;
        if (existing.requestDigest !== quote.requestDigest) throw new MarketplaceError("conflict", "Quote idempotency key reused with different terms");
        return existing;
      }
      quotes.set(quote.id, quote);
      quoteKeys.set(key, quote.id);
      return quote;
    },
    getQuote: async (buyerId, id) => {
      const result = quotes.get(id);
      return result?.buyerId === buyerId ? result : undefined;
    },
    putWork: async (work) => {
      const key = work.buyerId + ":" + work.idempotencyKey;
      const prev = workKeys.get(key);
      if (prev) {
        const existing = works.get(prev)!;
        if (existing.quoteId !== work.quoteId || existing.inputDigest !== work.inputDigest) {
          throw new MarketplaceError("conflict", "Work idempotency key reused with different terms");
        }
        return existing;
      }
      works.set(work.id, work);
      workKeys.set(key, work.id);
      return work;
    },
    getWork: async (buyerId, id) => {
      const result = works.get(id);
      return result?.buyerId === buyerId ? result : undefined;
    },
  };
}
