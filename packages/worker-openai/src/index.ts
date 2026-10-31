import { Effect, Schema } from "effect";
import { WorkError, type WorkOrder, type WorkResult } from "@awc/contracts";
import type { Worker } from "@awc/runtime";

const ResponseSchema = Schema.Struct({
  id: Schema.String,
  status: Schema.String,
  output: Schema.Array(Schema.Struct({
    type: Schema.String,
    content: Schema.optionalKey(Schema.Array(Schema.Struct({
      type: Schema.String,
      text: Schema.optionalKey(Schema.String),
    }))),
  })),
});
export interface OpenAIWorkerConfig {
  readonly id: string;
  readonly taskTypeIds: readonly string[];
  readonly baseURL: string;
  readonly apiKey: string;
  readonly model: string;
  readonly instructions: string;
  readonly fetcher?: typeof fetch;
  readonly timeoutMs?: number;
}
/** This first adapter is intentionally synchronous/text-only; long gigs need a durable runner. */
export const createOpenAIWorker = (config: OpenAIWorkerConfig): Worker => {
  const url = new URL("/v1/responses", config.baseURL);
  if (url.protocol !== "https:" || !config.apiKey || !config.model) {
    throw new WorkError("invalid_input", "Worker requires HTTPS, model and credentials");
  }
  const fetcher = config.fetcher ?? fetch;
  return {
    id: config.id,
    taskTypeIds: config.taskTypeIds,
    execute: (order: WorkOrder) => Effect.tryPromise({
      try: async (): Promise<WorkResult> => {
        if (order.allowedEffects.length !== 0) {
          throw new Error("This worker cannot perform external side effects");
        }
        if (order.inputs.some((item) => item.kind !== "inline")) {
          throw new Error("Worker cannot fetch arbitrary external artifacts");
        }
        const prompt = JSON.stringify({
          taskTypeId: order.taskTypeId,
          inputs: order.inputs.map((item) => ({ name: item.name, mediaType: item.mediaType, data: item.data })),
        });
        if (prompt.length > 100_000) throw new Error("Inputs too large for text worker");
        const response = await fetcher(url, {
          method: "POST",
          headers: { authorization: "Bearer " + config.apiKey, "content-type": "application/json" },
          body: JSON.stringify({ model: config.model, instructions: config.instructions, input: prompt, stream: false, background: false, store: false }),
          redirect: "error",
          signal: AbortSignal.timeout(config.timeoutMs ?? 120_000),
        });
        if (!response.ok) throw new Error("Upstream model request failed");
        const data = Schema.decodeUnknownSync(ResponseSchema)(await response.json());
        if (data.status !== "completed") throw new Error("Response has not completed");
        const text = data.output.flatMap((o) => o.content ?? [])
          .filter((c) => c.type === "output_text" && typeof c.text === "string")
          .map((c) => c.text)
          .join("\n");
        if (!text) throw new Error("Model response contained no text output");
        return {
          orderId: order.id, summary: "Model response completed",
          producedAt: new Date().toISOString(), executionRef: data.id,
          artifacts: [{ name: "result.txt", mediaType: "text/plain", kind: "inline", data: text }],
        };
      },
      catch: () => new WorkError("execution_failed", "Text worker failed; inspect authenticated runtime logs"),
    }),
  };
};
