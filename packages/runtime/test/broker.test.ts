import { describe, expect, it } from "vitest";
import { Effect, Layer } from "effect";
import type { WorkOrder, WorkResult } from "@awc/contracts";
import { WorkError } from "@awc/contracts";
import { PaymentGate, inMemoryRepositoryLayer, processIncomingWork, providersLayer, workersLayer } from "../src/index.ts";

const order: WorkOrder = {
  schemaVersion: "1", id: "source:one", sourceId: "source", sourceWorkId: "one",
  taskTypeId: "task:echo", offeringId: "offer:echo",
  inputs: [{ name: "question", kind: "inline", mediaType: "text/plain", data: "hello" }],
  budget: { currency: "USD", minorUnits: "100" }, funding: { kind: "demo", reference: "test" },
  allowedEffects: [], dataClassification: "public",
};
const outcome: WorkResult = { orderId: order.id, summary: "done", artifacts: [], producedAt: "2026-10-31T00:00:00Z" };
const fixture = (paid = true, failDelivery = false) => {
  let runs = 0, deliveries = 0;
  const layer = Layer.mergeAll(
    providersLayer([{ id: "source", ingest: (input) => Effect.succeed(input as WorkOrder), publish: () => {
      deliveries++;
      return failDelivery && deliveries === 1
        ? Effect.fail(new WorkError("delivery_failed", "Callback unavailable"))
        : Effect.void;
    } }]),
    workersLayer([{ id: "echo", taskTypeIds: ["task:echo"], execute: () => { runs++; return Effect.succeed(outcome); } }]),
    inMemoryRepositoryLayer(),
    Layer.succeed(PaymentGate, { assertFunded: () =>
      paid ? Effect.void : Effect.fail(new WorkError("payment_required", "Not paid")) }),
  );
  const invoke = () => Effect.runPromise(processIncomingWork("source", order).pipe(Effect.provide(layer)));
  return { invoke, stats: () => ({ runs, deliveries }) };
};
describe("work broker", () => {
  it("executes, persists and publishes once", async () => {
    const f = fixture();
    expect((await f.invoke()).status).toBe("delivered");
    expect((await f.invoke()).status).toBe("delivered");
    expect(f.stats()).toEqual({ runs: 1, deliveries: 1 });
  });
  it("never executes an unfunded order", async () => {
    const f = fixture(false);
    await expect(f.invoke()).rejects.toThrow("Not paid");
    expect(f.stats().runs).toBe(0);
  });
  it("retries publishing without re-executing", async () => {
    const f = fixture(true, true);
    await expect(f.invoke()).rejects.toThrow("Callback unavailable");
    expect((await f.invoke()).status).toBe("delivered");
    expect(f.stats()).toEqual({ runs: 1, deliveries: 2 });
  });
});
