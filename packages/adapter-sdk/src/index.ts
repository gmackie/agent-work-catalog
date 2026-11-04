import { Context, Effect, Layer, Schema } from "effect";
import { Money, WorkArtifact, WorkInput, WorkResult, assertArtifactShape } from "@awc/contracts";
import type { WorkResult as WorkResultType } from "@awc/contracts";

/** Manifest is descriptive only: publication requires independently verified identity and permissions. */
export const AdapterManifest = Schema.Struct({
  schemaVersion: Schema.Literal("awc.adapter/v1"),
  id: Schema.String,
  version: Schema.String,
  displayName: Schema.String,
  roles: Schema.Array(Schema.Literals(["work-source", "work-executor", "delivery-sink"])),
  transport: Schema.Literals(["in-process-effect", "remote-http", "github-app"]),
  supportedTaskTypes: Schema.Array(Schema.String),
  capabilities: Schema.Array(Schema.String),
});
export type AdapterManifest = typeof AdapterManifest.Type;

export const ExternalWorkRef = Schema.Struct({
  sourceId: Schema.String,
  externalId: Schema.String,
  originUrl: Schema.String,
  installationId: Schema.optionalKey(Schema.String),
  repositoryId: Schema.optionalKey(Schema.String),
  issueNumber: Schema.optionalKey(Schema.Number),
});
export type ExternalWorkRef = typeof ExternalWorkRef.Type;

export const WorkOpportunity = Schema.Struct({
  schemaVersion: Schema.Literal("awc.opportunity/v1"),
  id: Schema.String,
  external: ExternalWorkRef,
  title: Schema.String,
  description: Schema.String,
  observedAt: Schema.String,
  status: Schema.Literals(["open", "closed"]),
  eventId: Schema.String,
  taskTypeHint: Schema.optionalKey(Schema.String),
});
export type WorkOpportunity = typeof WorkOpportunity.Type;

export const ExecutionRequest = Schema.Struct({
  schemaVersion: Schema.Literal("awc.execution/v1"),
  executionId: Schema.String,
  attemptId: Schema.String,
  idempotencyKey: Schema.String,
  workOrderId: Schema.String,
  contractDigest: Schema.String,
  taskTypeId: Schema.String,
  offeringId: Schema.String,
  inputs: Schema.Array(WorkInput),
  requiredOutputs: Schema.Array(Schema.Struct({
    role: Schema.String,
    mediaType: Schema.String,
  })),
  constraints: Schema.Struct({
    maxCost: Money,
    allowedEffects: Schema.Array(Schema.String),
    dataClassification: Schema.Literals(["public", "internal", "confidential"]),
    deadlineAt: Schema.optionalKey(Schema.String),
    maxDurationSeconds: Schema.Number,
  }),
  grantRef: Schema.optionalKey(Schema.String),
});
export type ExecutionRequest = typeof ExecutionRequest.Type;

export const ExecutionHandle = Schema.Struct({
  executionId: Schema.String,
  providerExecutionId: Schema.String,
  status: Schema.Literals(["queued", "running", "input_required", "completed", "failed", "cancelled", "unknown"]),
});
export type ExecutionHandle = typeof ExecutionHandle.Type;

export const ExecutionSnapshot = Schema.Struct({
  handle: ExecutionHandle,
  status: ExecutionHandle.fields.status,
  updatedAt: Schema.String,
  message: Schema.optionalKey(Schema.String),
  progressPercent: Schema.optionalKey(Schema.Number),
  result: Schema.optionalKey(WorkResult),
});
export type ExecutionSnapshot = typeof ExecutionSnapshot.Type;

export const WorkDelivery = Schema.Struct({
  workOrderId: Schema.String,
  contractDigest: Schema.String,
  idempotencyKey: Schema.String,
  result: WorkResult,
});
export type WorkDelivery = typeof WorkDelivery.Type;

export type SourceIngestResult =
  | { readonly type: "ignored"; readonly reason: string; readonly eventId?: string }
  | { readonly type: "opportunity"; readonly opportunity: WorkOpportunity };

/** Bytes and headers are untrusted until the source-specific ingress validator authenticates them. */
export interface SourceEventEnvelope {
  readonly body: Uint8Array;
  readonly headers: Readonly<Record<string, string>>;
}
export interface DeliveryAck {
  readonly externalRef: ExternalWorkRef;
  readonly receiptId: string;
  readonly deliveredAt: string;
  readonly duplicate: boolean;
}
export interface ExternalWorkState {
  readonly ref: ExternalWorkRef;
  readonly status: "open" | "closed" | "unavailable";
  readonly observedAt: string;
}
export type CancelResult = {
  readonly status: "requested" | "cancelled" | "already_terminal" | "unsupported";
  readonly handle: ExecutionHandle;
};

export class AdapterError extends Error {
  readonly _tag = "AdapterError";
  constructor(
    readonly code: "invalid_input" | "unauthenticated" | "unauthorized" | "unsupported" |
      "not_found" | "unavailable" | "rate_limited" | "conflict" | "outcome_unknown",
    message: string,
  ) { super(message); this.name = "AdapterError"; }
}
export interface WorkSource {
  readonly manifest: AdapterManifest;
  /** Verify the upstream signature and its repository/installation scope before normalizing. */
  readonly ingest: (event: SourceEventEnvelope) => Effect.Effect<SourceIngestResult, AdapterError>;
  /** Query the authoritative upstream API; never infer external status from a webhook alone. */
  readonly inspect: (ref: ExternalWorkRef) => Effect.Effect<ExternalWorkState, AdapterError>;
  /** Requires a broker-issued delivery authorization via injected adapter policy. */
  readonly deliver: (ref: ExternalWorkRef, delivery: WorkDelivery) => Effect.Effect<DeliveryAck, AdapterError>;
}
export interface WorkExecutor {
  readonly manifest: AdapterManifest;
  /** A repeated invocation with the same idempotency key MUST resolve to the same execution. */
  readonly start: (request: ExecutionRequest) => Effect.Effect<ExecutionHandle, AdapterError>;
  readonly inspect: (handle: ExecutionHandle) => Effect.Effect<ExecutionSnapshot, AdapterError>;
  /** Inspect by original client idempotency key after ambiguous start outcomes. */
  readonly recover: (request: ExecutionRequest) => Effect.Effect<ExecutionHandle | null, AdapterError>;
  readonly cancel: (handle: ExecutionHandle) => Effect.Effect<CancelResult, AdapterError>;
  readonly signal?: (handle: ExecutionHandle, name: string, input: unknown) => Effect.Effect<void, AdapterError>;
}

/** Explicit composition of trusted, installed code; never dynamically execute an untrusted manifest. */
export interface AdapterRegistry {
  readonly source: (id: string) => Effect.Effect<WorkSource, AdapterError>;
  readonly executor: (id: string) => Effect.Effect<WorkExecutor, AdapterError>;
  readonly manifests: () => readonly AdapterManifest[];
}
export class AdapterRegistryService extends Context.Service<AdapterRegistryService, AdapterRegistry>()("@awc/AdapterRegistry") {}
export function registryLayer(sources: readonly WorkSource[], executors: readonly WorkExecutor[]) {
  const ids = new Set<string>();
  const sourceMap = new Map<string, WorkSource>();
  const executorMap = new Map<string, WorkExecutor>();
  for (const source of sources) {
    assertManifest(source.manifest);
    if (!source.manifest.roles.includes("work-source")) throw new AdapterError("invalid_input", "Source role missing");
    if (ids.has(source.manifest.id)) throw new AdapterError("conflict", "Duplicate adapter ID");
    ids.add(source.manifest.id);
    sourceMap.set(source.manifest.id, source);
  }
  for (const executor of executors) {
    assertManifest(executor.manifest);
    if (!executor.manifest.roles.includes("work-executor")) throw new AdapterError("invalid_input", "Executor role missing");
    if (ids.has(executor.manifest.id)) throw new AdapterError("conflict", "Duplicate adapter ID");
    ids.add(executor.manifest.id);
    executorMap.set(executor.manifest.id, executor);
  }
  const registry: AdapterRegistry = {
    source: id => {
      const found = sourceMap.get(id);
      return found ? Effect.succeed(found) : Effect.fail(new AdapterError("not_found", "Source adapter not installed"));
    },
    executor: id => {
      const found = executorMap.get(id);
      return found ? Effect.succeed(found) : Effect.fail(new AdapterError("not_found", "Executor adapter not installed"));
    },
    manifests: () => [...sourceMap.values(), ...executorMap.values()].map(item => item.manifest),
  };
  return Layer.succeed(AdapterRegistryService, registry);
}
export function assertManifest(manifest: AdapterManifest): void {
  Schema.decodeUnknownSync(AdapterManifest)(manifest);
  if (!/^[a-z0-9][a-z0-9.-]{2,100}$/.test(manifest.id) ||
    !/^\d+\.\d+\.\d+(-[a-z0-9.-]+)?$/.test(manifest.version) ||
    !manifest.roles.length || new Set(manifest.roles).size !== manifest.roles.length)
    throw new AdapterError("invalid_input", "Adapter manifest ID, version or roles invalid");
}
export function validateExecutionRequest(value: unknown): ExecutionRequest {
  const req = Schema.decodeUnknownSync(ExecutionRequest)(value);
  if (!/^[a-f0-9]{64}$/.test(req.contractDigest) ||
    req.inputs.length > 20 || req.requiredOutputs.length > 20 ||
    req.constraints.maxDurationSeconds <= 0 || req.constraints.maxDurationSeconds > 86400 ||
    !/^(0|[1-9]\d*)$/.test(req.constraints.maxCost.minorUnits)) {
    throw new AdapterError("invalid_input", "Invalid execution request constraints");
  }
  for (const input of req.inputs) assertArtifactShape(input);
  if (JSON.stringify(req).length > 128_000) throw new AdapterError("invalid_input", "Execution request too large");
  return req;
}
export function validateExecutionSnapshot(value: unknown, original: ExecutionRequest): ExecutionSnapshot {
  const snapshot = Schema.decodeUnknownSync(ExecutionSnapshot)(value);
  if (snapshot.handle.executionId !== original.executionId ||
    snapshot.handle.status !== snapshot.status ||
    (snapshot.result && (snapshot.status !== "completed" || snapshot.result.orderId !== original.workOrderId)) ||
    (snapshot.progressPercent !== undefined && (snapshot.progressPercent < 0 || snapshot.progressPercent > 100))) {
    throw new AdapterError("invalid_input", "Executor response does not match requested work");
  }
  return snapshot;
}
export function validateDelivery(value: unknown): WorkDelivery {
  const delivery = Schema.decodeUnknownSync(WorkDelivery)(value);
  if (delivery.workOrderId !== delivery.result.orderId ||
    !/^[a-f0-9]{64}$/.test(delivery.contractDigest)) {
    throw new AdapterError("invalid_input", "Delivery does not match its result or contract");
  }
  if (JSON.stringify(delivery).length > 128_000) throw new AdapterError("invalid_input", "Delivery too large");
  return delivery;
}
