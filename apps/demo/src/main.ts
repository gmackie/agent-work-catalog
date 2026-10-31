import { Effect, Layer } from "effect";
import { validateOrder, type WorkOrder, type WorkResult, WorkError } from "@awc/contracts";
import { inMemoryRepositoryLayer, PaymentGate, processIncomingWork, providersLayer, workersLayer } from "@awc/runtime";

const order: WorkOrder = {
  schemaVersion: "1",
  id: "demo-market:job-001",
  sourceId: "demo-market",
  sourceWorkId: "job-001",
  offeringId: "demo:summary",
  taskTypeId: "task:summary",
  inputs: [{ name: "prompt", mediaType: "text/plain", kind: "inline", data: "Summarize the provider/worker boundary." }],
  budget: { currency: "USD", minorUnits: "100" },
  funding: { kind: "demo", reference: "sandbox-only" },
  dataClassification: "public",
  allowedEffects: [],
};

const provider = {
  id: "demo-market",
  ingest: (payload: unknown) => Effect.try({
    try: () => validateOrder(payload),
    catch: () => new WorkError("invalid_input", "Bad demo payload"),
  }),
  publish: (request: WorkOrder, result: WorkResult) =>
    Effect.sync(() => console.log("DELIVERED", JSON.stringify({ order: request.id, result }, null, 2))),
};

const worker = {
  id: "deterministic-demo-worker",
  taskTypeIds: ["task:summary"],
  execute: (request: WorkOrder) => Effect.succeed({
    orderId: request.id,
    producedAt: new Date().toISOString(),
    summary: "Demonstration completed without paid inference",
    artifacts: [{ name: "summary.txt", mediaType: "text/plain", kind: "inline", data: "WorkProvider supplies tasks; Worker executes them; PaymentGate authorizes billing independently." }],
  } satisfies WorkResult),
};

/** This payment gate intentionally rejects every non-demo funding mechanism. */
const SandboxPayment = Layer.succeed(PaymentGate, {
  assertFunded: (request: WorkOrder) =>
    request.funding.kind === "demo" && request.funding.reference === "sandbox-only" ?
      Effect.void : Effect.fail(new WorkError("payment_required", "Demo cannot authorize real spending")),
});
const services = Layer.mergeAll(
  providersLayer([provider]), workersLayer([worker]), inMemoryRepositoryLayer(), SandboxPayment,
);

const run = processIncomingWork("demo-market", order).pipe(Effect.provide(services));
Effect.runPromise(run)
  .then((value) => console.log("WORK ORDER", value.status))
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
