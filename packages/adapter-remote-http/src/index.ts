import { Effect, Schema } from "effect";
import {
  AdapterError, ExecutionHandle, ExecutionSnapshot, validateExecutionRequest, validateExecutionSnapshot,
  type WorkExecutor, type ExecutionRequest, type ExecutionHandle as Handle,
  type ExecutionSnapshot as Snapshot, type CancelResult,
} from "@awc/adapter-sdk";

export interface RemoteExecutorConfig {
  readonly id: string;
  readonly baseUrl: string;
  readonly allowedHost: string;
  /** Different per remote provider, stored in Worker secret bindings, never in an MCP prompt. */
  readonly sharedKey: string;
  readonly supportedTaskTypes: readonly string[];
  readonly fetcher?: typeof fetch;
  readonly now?: () => number;
  readonly timeoutMs?: number;
}
const encoder = new TextEncoder();
export const digest = async (body: string): Promise<string> => {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(body)));
  return [...bytes].map(x => x.toString(16).padStart(2, "0")).join("");
};
const hmac = async (secret: string, message: string): Promise<string> => {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return [...new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(message)))]
    .map(n => n.toString(16).padStart(2, "0")).join("");
};
const sameSignature = (a: string, b: string): boolean => {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
};
function endpoint(config: RemoteExecutorConfig): URL {
  const uri = new URL(config.baseUrl);
  if (uri.protocol !== "https:" || uri.hostname !== config.allowedHost ||
      uri.port !== "" || uri.username || uri.password || uri.search || uri.hash ||
      (uri.pathname !== "/" && uri.pathname !== "") ||
      uri.hostname === "localhost" || /^(127\.|10\.|192\.168\.|169\.254\.)/.test(uri.hostname)) {
    throw new AdapterError("invalid_input", "Remote executor requires an allowlisted HTTPS origin");
  }
  if (config.sharedKey.length < 32 || !config.supportedTaskTypes.length) {
    throw new AdapterError("invalid_input", "Remote executor needs its own signing key and task contract");
  }
  return uri;
}
function safeSegment(value: string): string {
  if (!/^[a-zA-Z0-9_.:-]{1,160}$/.test(value) || value === "." || value === "..") {
    throw new AdapterError("invalid_input", "Invalid provider execution identifier");
  }
  return encodeURIComponent(value);
}
const remoteError = (e: unknown, ambiguous = false) =>
  e instanceof AdapterError ? e :
  new AdapterError(ambiguous ? "outcome_unknown" : "unavailable",
    ambiguous ? "Remote operation may have succeeded; reconcile by idempotency key" :
      "Remote adapter request failed");

/**
 * Sender and recipient agree on the exact raw-body signing profile.
 * Keyed by method, path, timestamp, idempotency key and body digest.
 * HTTPS plus a trusted adapter installation remains mandatory.
 */
export async function signAwcRequest(
  secret: string, method: string, pathname: string,
  timestamp: string, idempotencyKey: string, body: string,
) {
  return hmac(secret, [method, pathname, timestamp, idempotencyKey, await digest(body)].join("\n"));
}
export async function verifyAwcRequest(
  request: Request, secret: string, now = Date.now(),
): Promise<{body: string; idempotencyKey: string}> {
  if (secret.length < 32) throw new AdapterError("unavailable", "Signing key unavailable");
  if (new URL(request.url).search || new URL(request.url).hash) {
    throw new AdapterError("unauthenticated", "Signed remote protocol does not permit query parameters");
  }
  const timestamp = request.headers.get("x-awc-timestamp") ?? "";
  const idempotencyKey = request.headers.get("x-awc-idempotency-key") ?? "";
  const signature = request.headers.get("x-awc-signature") ?? "";
  if (!/^\d{13}$/.test(timestamp) || !/^[a-zA-Z0-9_.:-]{8,160}$/.test(idempotencyKey) ||
      !/^[a-f0-9]{64}$/.test(signature) ||
      Math.abs(now - Number(timestamp)) > 300_000) {
    throw new AdapterError("unauthenticated", "Invalid or expired signature headers");
  }
  const body = await request.text();
  if (body.length > 128_000) throw new AdapterError("invalid_input", "Request body exceeds limit");
  const expected = await signAwcRequest(secret, request.method, new URL(request.url).pathname,
    timestamp, idempotencyKey, body);
  if (!sameSignature(signature, expected)) throw new AdapterError("unauthenticated", "Invalid request signature");
  return { body, idempotencyKey };
}
const RemoteHandleResponse = Schema.Struct({
  schemaVersion: Schema.Literal("awc.executor/v1"),
  handle: ExecutionHandle,
});
const RemoteSnapshotResponse = Schema.Struct({
  schemaVersion: Schema.Literal("awc.executor/v1"),
  snapshot: ExecutionSnapshot,
});
const RemoteCancelResponse = Schema.Struct({
  schemaVersion: Schema.Literal("awc.executor/v1"),
  status: Schema.Literals(["requested", "cancelled", "already_terminal", "unsupported"]),
  handle: ExecutionHandle,
});

export function createRemoteHttpExecutor(config: RemoteExecutorConfig): WorkExecutor {
  const base = endpoint(config);
  const fetcher = config.fetcher ?? fetch;
  const now = config.now ?? Date.now;
  const timeout = Math.max(1000, Math.min(config.timeoutMs ?? 20_000, 30_000));
  async function send<T>(
    method: "GET" | "POST", path: string, key: string, payload: unknown,
    decoder: (value: unknown) => T, ambiguous: boolean,
  ): Promise<{value:T;notFound:boolean}> {
    const url = new URL(path, base);
    const body = payload === undefined ? "" : JSON.stringify(payload);
    const timestamp = String(now());
    const signature = await signAwcRequest(config.sharedKey, method, url.pathname,
      timestamp, key, body);
    let response: Response;
    try {
      response = await fetcher(url, {
        method, headers: {
          "accept": "application/json",
          "content-type": "application/json",
          "x-awc-timestamp": timestamp,
          "x-awc-idempotency-key": key,
          "x-awc-signature": signature,
        }, ...(method === "POST" ? { body } : {}),
        redirect: "error",
        signal: AbortSignal.timeout(timeout),
      });
    } catch (cause) {
      throw remoteError(cause, ambiguous);
    }
    if (response.status === 404 && method === "GET") return { value: undefined as T, notFound: true };
    if (response.status === 429) throw new AdapterError("rate_limited", "Remote rate limit");
    if (response.status === 401 || response.status === 403) throw new AdapterError("unauthorized", "Remote access denied");
    if (response.status === 409) throw new AdapterError("conflict", "Remote idempotency or state conflict");
    if (!response.ok) throw new AdapterError(response.status >= 500 && ambiguous ? "outcome_unknown" : "unavailable",
      "Remote executor returned an unsuccessful status");
    if (Number(response.headers.get("content-length") ?? 0) > 150_000) {
      throw new AdapterError(ambiguous ? "outcome_unknown" : "invalid_input", "Remote response exceeded size limit");
    }
    try {
      const raw = await response.text();
      if (raw.length > 150_000) throw new Error("Response size");
      return { value: decoder(JSON.parse(raw)), notFound: false };
    } catch (cause) {
      throw remoteError(cause, ambiguous);
    }
  }
  const decodeHandle = (value:unknown) => Schema.decodeUnknownSync(RemoteHandleResponse)(value).handle;
  return {
    manifest: {
      schemaVersion:"awc.adapter/v1",id:config.id,version:"1.0.0",
      displayName:"AWC signed remote HTTP executor",
      roles:["work-executor"],transport:"remote-http",
      supportedTaskTypes:[...config.supportedTaskTypes],
      capabilities:["start","inspect","recover","cancel"],
    },
    start: request => Effect.tryPromise({
      try:async()=>{
        const valid=(() => {
          try { return validateExecutionRequest(request); }
          catch (error) {
            if (error instanceof AdapterError) throw error;
            throw new AdapterError("invalid_input","Execution request failed schema validation");
          }
        })();
        if (!config.supportedTaskTypes.includes(valid.taskTypeId)) {
          throw new AdapterError("unsupported","Task type not registered for executor");
        }
        const {value}=await send("POST","/v1/executions",valid.idempotencyKey,
          valid,decodeHandle,true);
        if (value.executionId !== valid.executionId) {
          throw new AdapterError("outcome_unknown","Provider returned a mismatched execution; reconcile before retry");
        }
        return value;
      },catch:cause=>remoteError(cause,true),
    }),
    recover: request => Effect.tryPromise({
      try:async()=>{
        const valid=validateExecutionRequest(request);
        const path="/v1/executions/by-idempotency/"+safeSegment(valid.idempotencyKey);
        const {value,notFound}=await send("GET",path,valid.idempotencyKey,undefined,decodeHandle,false);
        if (notFound) return null;
        if (value.executionId!==valid.executionId) throw new AdapterError("conflict","Recovered execution ID mismatch");
        return value;
      },catch:cause=>remoteError(cause),
    }),
    inspect: handle => Effect.tryPromise({
      try:async()=>{
        const path="/v1/executions/"+safeSegment(handle.providerExecutionId);
        const {value,notFound}=await send("GET",path,handle.executionId,undefined,
          x=>Schema.decodeUnknownSync(RemoteSnapshotResponse)(x).snapshot,false);
        if (notFound) throw new AdapterError("not_found","Remote execution not found");
        if (value.handle.executionId!==handle.executionId ||
          value.handle.providerExecutionId!==handle.providerExecutionId ||
          value.handle.status!==value.status) {
          throw new AdapterError("conflict","Provider execution handle mismatch");
        }
        return value;
      },catch:cause=>remoteError(cause),
    }),
    cancel: handle => Effect.tryPromise({
      try:async()=>{
        const path="/v1/executions/"+safeSegment(handle.providerExecutionId)+"/cancel";
        const {value}=await send("POST",path,handle.executionId+":cancel",{executionId:handle.executionId},
          x=>Schema.decodeUnknownSync(RemoteCancelResponse)(x),true);
        if (value.handle.executionId!==handle.executionId ||
          value.handle.providerExecutionId!==handle.providerExecutionId) {
          throw new AdapterError("outcome_unknown","Cancellation response references another job");
        }
        return {status:value.status,handle:value.handle} as CancelResult;
      },catch:cause=>remoteError(cause,true),
    }),
  };
}
