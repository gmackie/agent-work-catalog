import { Effect } from "effect";
import { validateOrder, WorkError, type WorkOrder, type WorkResult } from "@awc/contracts";
import type { WorkProvider } from "@awc/runtime";

export interface SignedWebhook {
  readonly body: string;
  readonly timestamp: string;
  readonly signature: string;
}
export interface HttpProviderConfig {
  readonly id: string;
  /** Key used only for this WorkProvider integration; never expose it to an LLM. */
  readonly secret: string;
  /** Fixed, administrator-configured HTTPS delivery URL; never from incoming payload. */
  readonly deliveryUrl: string;
  readonly fetcher?: typeof fetch;
  readonly now?: () => number;
}

const hex = (bytes: ArrayBuffer): string =>
  Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");

const mac = async (key: string, message: string): Promise<string> => {
  const encoder = new TextEncoder();
  const secret = await crypto.subtle.importKey(
    "raw", encoder.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  return hex(await crypto.subtle.sign("HMAC", secret, encoder.encode(message)));
};

const constantTimeHexEquals = (a: string, b: string): boolean => {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
};

/** Header signature: hex HMAC-SHA256(secret, timestamp + "." + raw UTF-8 body). */
export const signWebhook = (secret: string, timestamp: string, body: string) =>
  mac(secret, timestamp + "." + body);

export const createHttpWorkProvider = (config: HttpProviderConfig): WorkProvider => {
  const deliveryUrl = new URL(config.deliveryUrl);
  if (deliveryUrl.protocol !== "https:" || !config.secret) {
    throw new WorkError("invalid_input", "Provider requires a secret and an HTTPS delivery URL");
  }
  const fetcher = config.fetcher ?? fetch;
  const now = config.now ?? Date.now;
  return {
    id: config.id,
    ingest: (input: unknown) => Effect.tryPromise({
      try: async () => {
        if (!input || typeof input !== "object") throw new Error("Invalid webhook envelope");
        const envelope = input as SignedWebhook;
        if (typeof envelope.body !== "string" || envelope.body.length > 1_000_000) {
          throw new Error("Body must be text within configured size limit");
        }
        if (typeof envelope.timestamp !== "string" || !/^[0-9]+$/.test(envelope.timestamp)) {
          throw new Error("Invalid timestamp");
        }
        const timestamp = Number(envelope.timestamp);
        if (!Number.isSafeInteger(timestamp) || Math.abs(now() - timestamp) > 300_000) {
          throw new Error("Webhook timestamp expired");
        }
        const expected = await signWebhook(config.secret, envelope.timestamp, envelope.body);
        if (typeof envelope.signature !== "string" ||
            !/^[a-f0-9]{64}$/.test(envelope.signature) ||
            !constantTimeHexEquals(expected, envelope.signature)) {
          throw new Error("Invalid webhook signature");
        }
        const order = validateOrder(JSON.parse(envelope.body));
        if (order.sourceId !== config.id) throw new Error("Work source mismatch");
        return order;
      },
      catch: () => new WorkError("unauthorized", "Invalid, expired or malformed provider webhook"),
    }),
    publish: (order: WorkOrder, result: WorkResult) => Effect.tryPromise({
      try: async () => {
        const body = JSON.stringify({ orderId: order.id, sourceWorkId: order.sourceWorkId, result });
        const timestamp = String(now());
        const signature = await signWebhook(config.secret, timestamp, body);
        const response = await fetcher(deliveryUrl.toString(), {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-awc-timestamp": timestamp,
            "x-awc-signature": signature,
            "idempotency-key": order.id + ":delivery:v1",
          },
          body,
          redirect: "error",
          signal: AbortSignal.timeout(15_000),
        });
        if (!response.ok) throw new Error("Provider delivery callback rejected");
      },
      catch: () => new WorkError("delivery_failed", "Provider callback delivery failed; retry from persisted result"),
    }),
  };
};
