import { Context, Effect, Layer } from "effect";
import { assertArtifactShape, validateOrder, validateResult, WorkError } from "@awc/contracts";
import type { WorkOrder, WorkResult } from "@awc/contracts";

/** Upstream marketplace/work-provider adapter: parses jobs and publishes results. */
export interface WorkProvider {
  readonly id: string;
  readonly ingest: (payload: unknown) => Effect.Effect<WorkOrder, WorkError>;
  readonly publish: (order: WorkOrder, result: WorkResult) => Effect.Effect<void, WorkError>;
}

/** Executor adapter: AI, MCP, A2A, local computation, or a reviewed human-work bridge. */
export interface Worker {
  readonly id: string;
  readonly taskTypeIds: readonly string[];
  readonly execute: (order: WorkOrder) => Effect.Effect<WorkResult, WorkError>;
}

export interface WorkRecord {
  readonly order: WorkOrder;
  readonly status: "received" | "running" | "finished" | "delivered" | "failed";
  readonly result?: WorkResult;
  readonly failure?: string;
}

export class WorkProviders extends Context.Service<WorkProviders, {
  readonly resolve: (sourceId: string) => Effect.Effect<WorkProvider, WorkError>;
}>()("@awc/WorkProviders") {}

export class Workers extends Context.Service<Workers, {
  readonly resolve: (taskTypeId: string) => Effect.Effect<Worker, WorkError>;
}>()("@awc/Workers") {}

export class PaymentGate extends Context.Service<PaymentGate, {
  /** Reconciles against a trusted processor/ledger; raw source claims are not funding. */
  readonly assertFunded: (order: WorkOrder) => Effect.Effect<void, WorkError>;
}>()("@awc/PaymentGate") {}

export class WorkRepository extends Context.Service<WorkRepository, {
  readonly upsert: (order: WorkOrder) => Effect.Effect<WorkRecord, WorkError>;
  readonly get: (id: string) => Effect.Effect<WorkRecord, WorkError>;
  /** In production this must be a durable atomic lease with fencing. */
  readonly claim: (id: string) => Effect.Effect<boolean, WorkError>;
  readonly complete: (id: string, result: WorkResult) => Effect.Effect<void, WorkError>;
  readonly delivered: (id: string) => Effect.Effect<void, WorkError>;
  readonly failed: (id: string, reason: string) => Effect.Effect<void, WorkError>;
}>()("@awc/WorkRepository") {}

export const providersLayer = (providers: readonly WorkProvider[]) => {
  const byId = new Map(providers.map((provider) => [provider.id, provider]));
  return Layer.succeed(WorkProviders, {
    resolve: (id: string) => {
      const item = byId.get(id);
      return item ? Effect.succeed(item) :
        Effect.fail(new WorkError("not_found", "Unknown work provider"));
    },
  });
};

export const workersLayer = (workers: readonly Worker[]) => {
  const byTask = new Map<string, Worker>();
  for (const worker of workers) {
    for (const task of worker.taskTypeIds) {
      if (byTask.has(task)) throw new WorkError("invalid_input", "Task type has ambiguous worker routing");
      byTask.set(task, worker);
    }
  }
  return Layer.succeed(Workers, {
    resolve: (task: string) => {
      const item = byTask.get(task);
      return item ? Effect.succeed(item) :
        Effect.fail(new WorkError("not_found", "No worker configured for this task type"));
    },
  });
};

/** In-memory store for tests/demo only. No process restart recovery or distributed leases. */
export const inMemoryRepositoryLayer = () => {
  const records = new Map<string, WorkRecord>();
  const mutate = (id: string, expected: WorkRecord["status"], next: (item: WorkRecord) => WorkRecord) =>
    Effect.try({
      try: () => {
        const item = records.get(id);
        if (!item || item.status !== expected) throw new WorkError("duplicate", "Illegal or stale work state transition");
        records.set(id, next(item));
      },
      catch: (e) => e instanceof WorkError ? e : new WorkError("unavailable", "State transition failed"),
    });
  return Layer.succeed(WorkRepository, {
    upsert: (order: WorkOrder) => Effect.try({
      try: () => {
        const existing = records.get(order.id);
        if (existing) {
          if (JSON.stringify(existing.order) !== JSON.stringify(order)) {
            throw new WorkError("duplicate", "Work ID reused with a different contract");
          }
          return existing;
        }
        if (order.id !== order.sourceId + ":" + order.sourceWorkId) {
          throw new WorkError("invalid_input", "Work ID must bind source and source work ID");
        }
        const record: WorkRecord = { order, status: "received" };
        records.set(order.id, record);
        return record;
      },
      catch: (e) => e instanceof WorkError ? e : new WorkError("unavailable", "Failed to store work"),
    }),
    get: (id: string) => {
      const item = records.get(id);
      return item ? Effect.succeed(item) : Effect.fail(new WorkError("not_found", "Unknown work order"));
    },
    claim: (id: string) => Effect.sync(() => {
      const current = records.get(id);
      if (!current || current.status !== "received") return false;
      records.set(id, { ...current, status: "running" });
      return true;
    }),
    complete: (id: string, result: WorkResult) =>
      mutate(id, "running", (item) => ({ ...item, status: "finished", result })),
    delivered: (id: string) =>
      mutate(id, "finished", (item) => ({ ...item, status: "delivered" })),
    failed: (id: string, reason: string) =>
      mutate(id, "running", (item) => ({ ...item, status: "failed", failure: reason })),
  });
};

/** Delivers a persisted result; retries do not re-run worker inference. */
export const processIncomingWork = (sourceId: string, payload: unknown) =>
  Effect.gen(function* () {
    const sources = yield* WorkProviders;
    const executors = yield* Workers;
    const gate = yield* PaymentGate;
    const repository = yield* WorkRepository;
    const provider = yield* sources.resolve(sourceId);
    const order = yield* provider.ingest(payload);

    const validated = yield* Effect.try({
      try: () => {
        const o = validateOrder(order);
        if (o.sourceId !== sourceId) throw new WorkError("unauthorized", "Source does not match authenticated provider");
        for (const input of o.inputs) assertArtifactShape(input);
        return o;
      },
      catch: (e) => e instanceof WorkError ? e : new WorkError("invalid_input", "Malformed source work order"),
    });

    const previous = yield* repository.upsert(validated);
    if (previous.status === "delivered") return previous;
    if (previous.status === "finished" && previous.result !== undefined) {
      yield* provider.publish(validated, previous.result);
      yield* repository.delivered(validated.id);
      return yield* repository.get(validated.id);
    }
    if (previous.status !== "received") {
      return yield* Effect.fail(new WorkError("duplicate", "Work is running or failed; reconciliation required"));
    }

    yield* gate.assertFunded(validated);
    const acquired = yield* repository.claim(validated.id);
    if (!acquired) return yield* Effect.fail(new WorkError("duplicate", "Work claimed concurrently"));
    const worker = yield* executors.resolve(validated.taskTypeId);
    const candidate = yield* worker.execute(validated).pipe(Effect.catch((error) =>
      repository.failed(validated.id, error.message).pipe(Effect.flatMap(() => Effect.fail(error)))
    ));
    const result = yield* Effect.try({
      try: () => {
        const value = validateResult(candidate);
        if (value.orderId !== validated.id) throw new WorkError("invalid_input", "Worker output belongs to a different order");
        for (const artifact of value.artifacts) assertArtifactShape(artifact);
        return value;
      },
      catch: (e) => e instanceof WorkError ? e : new WorkError("invalid_input", "Malformed worker output"),
    }).pipe(Effect.catch((error) =>
      repository.failed(validated.id, error.message).pipe(Effect.flatMap(() => Effect.fail(error)))
    ));

    yield* repository.complete(validated.id, result);
    // Outbound publish must use a deterministic idempotency key. A failed callback leaves
    // this order FINISHED, so a later call retries delivery without another execution.
    yield* provider.publish(validated, result);
    yield* repository.delivered(validated.id);
    return yield* repository.get(validated.id);
  });
