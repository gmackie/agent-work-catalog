import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import type { WorkOrder } from "@awc/contracts";
import { createOpenAIWorker } from "../src/index.ts";

const order: WorkOrder = {
  schemaVersion: "1", id: "source:1", sourceId: "source", sourceWorkId: "1", taskTypeId: "task:text",
  offeringId: "offer:text", inputs: [{ name: "prompt", mediaType: "text/plain", kind: "inline", data: "hello" }],
  budget: { currency: "USD", minorUnits: "10" }, funding: { kind: "demo", reference: "test" },
  dataClassification: "public", allowedEffects: [],
};
describe("OpenAI-compatible worker", () => {
  it("extracts completed Responses output", async () => {
    const worker = createOpenAIWorker({
      id: "model", taskTypeIds: ["task:text"], model: "model", apiKey: "test",
      baseURL: "https://api.example", instructions: "Respond",
      fetcher: async () => new Response(JSON.stringify({
        id: "resp_1", status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: "result" }] }],
      }), { status: 200 }),
    });
    const result = await Effect.runPromise(worker.execute(order));
    expect(result.artifacts[0]?.data).toBe("result");
  });
  it("will not fetch untrusted artifact URLs", async () => {
    const worker = createOpenAIWorker({
      id: "model", taskTypeIds: ["task:text"], model: "model", apiKey: "test",
      baseURL: "https://api.example", instructions: "Respond",
      fetcher: async () => { throw new Error("Should never call fetch"); },
    });
    const referenceOrder = { ...order, inputs: [{ name: "file", kind: "reference" as const, mediaType: "application/pdf", reference: "artifact:test" }] };
    await expect(Effect.runPromise(worker.execute(referenceOrder))).rejects.toThrow();
  });
});
