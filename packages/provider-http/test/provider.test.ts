import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { createHttpWorkProvider, signWebhook } from "../src/index.ts";
import type { WorkOrder } from "@awc/contracts";

const order: WorkOrder = {
  schemaVersion: "1", id: "partner:123", sourceId: "partner", sourceWorkId: "123",
  taskTypeId: "task:read", offeringId: "offer:read",
  inputs: [{ name: "x", kind: "inline", mediaType: "text/plain", data: "hello" }],
  funding: { kind: "demo", reference: "test" }, budget: { currency: "USD", minorUnits: "1" },
  dataClassification: "public", allowedEffects: [],
};
describe("signed work provider", () => {
  it("accepts only a valid time-bound message for its source", async () => {
    const now = 1793440000000;
    const provider = createHttpWorkProvider({ id: "partner", secret: "test-key", deliveryUrl: "https://partner.example/results", now: () => now });
    const body = JSON.stringify(order);
    const timestamp = String(now);
    const signature = await signWebhook("test-key", timestamp, body);
    const decoded = await Effect.runPromise(provider.ingest({ body, timestamp, signature }));
    expect(decoded.id).toBe(order.id);
    await expect(Effect.runPromise(provider.ingest({ body: body + " ", timestamp, signature }))).rejects.toThrow();
    await expect(Effect.runPromise(provider.ingest({ body, timestamp: String(now - 500_000), signature }))).rejects.toThrow();
  });
});
