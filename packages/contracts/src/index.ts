import { Schema } from "effect";

/** All identifiers and references here are opaque to the transport adapters. */
export const Money = Schema.Struct({
  currency: Schema.String,
  minorUnits: Schema.String,
});
export type Money = typeof Money.Type;

/** URI artifacts are resolved by a trusted artifact gateway, never by arbitrary workers. */
export const WorkInput = Schema.Struct({
  name: Schema.String,
  mediaType: Schema.String,
  kind: Schema.Literals(["inline", "reference"]),
  data: Schema.optionalKey(Schema.Unknown),
  reference: Schema.optionalKey(Schema.String),
  sha256: Schema.optionalKey(Schema.String),
});
export type WorkInput = typeof WorkInput.Type;

export const WorkArtifact = Schema.Struct({
  name: Schema.String,
  mediaType: Schema.String,
  kind: Schema.Literals(["inline", "reference"]),
  data: Schema.optionalKey(Schema.Unknown),
  reference: Schema.optionalKey(Schema.String),
  sha256: Schema.optionalKey(Schema.String),
});
export type WorkArtifact = typeof WorkArtifact.Type;

export const FundingReference = Schema.Struct({
  kind: Schema.Literals(["stripe-checkout", "x402-settlement", "provider-credit", "demo"]),
  reference: Schema.String,
});
export type FundingReference = typeof FundingReference.Type;

/** A WorkOrder is a commercial promise, not an MCP Tasks or A2A Task execution handle. */
export const WorkOrder = Schema.Struct({
  schemaVersion: Schema.Literal("1"),
  id: Schema.String,
  sourceId: Schema.String,
  sourceWorkId: Schema.String,
  taskTypeId: Schema.String,
  offeringId: Schema.String,
  inputs: Schema.Array(WorkInput),
  budget: Money,
  funding: FundingReference,
  dataClassification: Schema.Literals(["public", "internal", "confidential"]),
  allowedEffects: Schema.Array(Schema.String),
  deadlineAt: Schema.optionalKey(Schema.String),
});
export type WorkOrder = typeof WorkOrder.Type;

export const WorkResult = Schema.Struct({
  orderId: Schema.String,
  summary: Schema.String,
  artifacts: Schema.Array(WorkArtifact),
  producedAt: Schema.String,
  executionRef: Schema.optionalKey(Schema.String),
});
export type WorkResult = typeof WorkResult.Type;

export const TaskType = Schema.Struct({
  id: Schema.String,
  version: Schema.String,
  name: Schema.String,
  description: Schema.String,
  inputMediaTypes: Schema.Array(Schema.String),
  outputMediaTypes: Schema.Array(Schema.String),
  permittedEffects: Schema.Array(Schema.String),
});
export type TaskType = typeof TaskType.Type;

export const Offering = Schema.Struct({
  id: Schema.String,
  version: Schema.String,
  providerId: Schema.String,
  taskTypeId: Schema.String,
  title: Schema.String,
  description: Schema.String,
  pricing: Schema.Struct({
    mode: Schema.Literals(["metered", "fixed", "quoted", "subscription"]),
    fixedAmount: Schema.optionalKey(Money),
  }),
  execution: Schema.Array(Schema.Struct({
    protocol: Schema.Literals(["openai-responses", "openai-chat", "mcp", "a2a", "custom"]),
    endpoint: Schema.String,
  })),
});
export type Offering = typeof Offering.Type;

export const validateOrder = Schema.decodeUnknownSync(WorkOrder);
export const validateResult = Schema.decodeUnknownSync(WorkResult);
export const validateOffering = Schema.decodeUnknownSync(Offering);

export class WorkError extends Error {
  readonly _tag = "WorkError";
  constructor(
    readonly code: "invalid_input" | "not_found" | "duplicate" | "payment_required" |
      "unauthorized" | "execution_failed" | "delivery_failed" | "unavailable",
    message: string,
  ) {
    super(message);
    this.name = "WorkError";
  }
}

export const parseMinorUnits = (value: string): bigint => {
  if (!/^(0|[1-9][0-9]*)$/.test(value)) {
    throw new WorkError("invalid_input", "Money must be a nonnegative integer minor-units string");
  }
  return BigInt(value);
};

/** An artifact is either inline JSON or an opaque gateway reference, never both. */
export function assertArtifactShape(item: WorkInput | WorkArtifact): void {
  if (item.kind === "inline" && (item.data === undefined || item.reference !== undefined)) {
    throw new WorkError("invalid_input", "Inline artifact requires only data");
  }
  if (item.kind === "reference" && (item.reference === undefined || item.data !== undefined)) {
    throw new WorkError("invalid_input", "Reference artifact requires only reference");
  }
  if (item.reference !== undefined && !item.reference.startsWith("artifact:")) {
    throw new WorkError("invalid_input", "Artifact reference must be an opaque artifact: identifier");
  }
}
