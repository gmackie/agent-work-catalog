import { createMcpHandler } from "agents/mcp/server";
import { makeMarketplace } from "@awc/marketplace";
import { d1MarketplaceStore, type D1Database } from "@awc/marketplace/d1";
import { createCatalogMcpServer, type PaidSandboxConfig } from "@awc/mcp-server";

export interface Env {
  readonly DB: D1Database;
  readonly ASSETS: { fetch(request: Request | URL | string): Promise<Response> };
  /** One sandbox principal only. Set using wrangler secret put AWC_BUYER_TOKEN. */
  readonly AWC_BUYER_TOKEN?: string;
  readonly ENABLE_X402_TESTNET?: string;
  readonly X402_TESTNET_RECIPIENT?: string;
  readonly X402_FACILITATOR_URL?: string;
  readonly ALLOWED_ORIGINS?: string;
}
const asJson = (value: object, status = 200) =>
  Response.json(value, { status, headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } });
const sha = async (text: string): Promise<Uint8Array> =>
  new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));

async function matchSecret(actual: string | undefined, expected: string | undefined): Promise<boolean> {
  if (!expected || expected.length < 32 || !actual || actual.length !== expected.length) return false;
  const a = await sha(actual);
  const b = await sha(expected);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}
const isAllowedOrigin = (request: Request, env: Env): boolean => {
  const origin = request.headers.get("origin");
  if (!origin) return true; // Server-to-server MCP client.
  if (origin === new URL(request.url).origin) return true;
  return (env.ALLOWED_ORIGINS ?? "").split(",").map((value) => value.trim()).includes(origin);
};

/** Check routing headers against the body; the proxy/gateway MUST NOT trust caller-supplied headers alone. */
async function mismatchedToolHeader(request: Request): Promise<boolean> {
  if (request.method !== "POST" || request.headers.get("mcp-method") !== "tools/call") return false;
  const bytes = await request.clone().text();
  if (bytes.length > 128_000) return true;
  try {
    const body: unknown = JSON.parse(bytes);
    if (!body || Array.isArray(body) || typeof body !== "object") return true;
    const obj = body as { method?: unknown; params?: { name?: unknown } };
    const headerName = request.headers.get("mcp-name");
    return obj.method !== "tools/call" || typeof obj.params?.name !== "string" ||
      (headerName !== null && headerName !== obj.params.name);
  } catch {
    return true;
  }
}
function testnetConfig(env: Env): PaidSandboxConfig | undefined {
  if (env.ENABLE_X402_TESTNET !== "true") return undefined;
  if (!/^0x[a-fA-F0-9]{40}$/.test(env.X402_TESTNET_RECIPIENT ?? "")) {
    throw new Error("Testnet x402 enabled without a valid recipient address");
  }
  const facilitatorUrl = env.X402_FACILITATOR_URL ?? "https://x402.org/facilitator";
  if (new URL(facilitatorUrl).protocol !== "https:") throw new Error("x402 facilitator must use HTTPS");
  return { network: "base-sepolia", recipient: env.X402_TESTNET_RECIPIENT!, facilitatorUrl };
}
const connectPage = `<!doctype html><html lang="en"><meta charset="utf-8"><title>Agent Work Catalog</title>
<body style="max-width:720px;margin:3rem auto;font:16px system-ui;line-height:1.5">
<h1>Agent Work Catalog</h1><p>Experimental MCP endpoint: <code>/mcp</code>.</p>
<p>Public tools: <code>catalog.search</code>, <code>catalog.get_offering</code>. A buyer account can
request quotes and prepare <strong>unfunded</strong> work orders using its sandbox bearer credential.</p>
<p>Catalog entries are fictional demonstrations. No work will be executed and no live payment accepted.</p>
</body></html>`;

export async function handleRequest(
  request: Request, env: Env, ctx: ExecutionContext,
): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === "/health" && request.method === "GET") {
    return asJson({ status: "ok", service: "awc-mcp", paymentMode: "sandbox-only" });
  }
  if ((url.pathname === "/" || url.pathname === "/connect") && request.method === "GET") {
    return new Response(connectPage, {
      headers: { "content-type": "text/html; charset=utf-8", "x-content-type-options": "nosniff" },
    });
  }
  if (url.pathname !== "/mcp") return asJson({ error: "not_found" }, 404);
  if (!isAllowedOrigin(request, env)) return asJson({ error: "origin_not_allowed" }, 403);
  if (await mismatchedToolHeader(request)) return asJson({ error: "routing_header_mismatch" }, 400);

  const authorization = request.headers.get("authorization") ?? "";
  const bearer = authorization.startsWith("Bearer ") ? authorization.slice(7) : undefined;
  const buyerId = await matchSecret(bearer, env.AWC_BUYER_TOKEN) ? "sandbox-buyer" : null;
  const ui = await env.ASSETS.fetch("https://assets.local/marketplace.html");
  const appHtml = ui.ok ? await ui.text() : "";
  const marketplace = makeMarketplace(d1MarketplaceStore(env.DB));

  const handler = createMcpHandler(() => createCatalogMcpServer({
    marketplace, buyerId, appHtml,
    ...(testnetConfig(env) ? { paidSandbox: testnetConfig(env)! } : {}),
  }), { route: "/mcp", corsOptions: false });
  return handler(request, env, ctx);
}

export default {
  fetch: handleRequest,
} satisfies ExportedHandler<Env>;
