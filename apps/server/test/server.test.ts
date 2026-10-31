import { describe, expect, it } from "vitest";
import { handleRequest, type Env } from "../src/index.ts";

const env = {
  ENABLE_X402_TESTNET: "false",
  ASSETS: { fetch: async () => new Response("not found", {status:404}) },
} as unknown as Env;
const ctx = { waitUntil: () => {} } as unknown as ExecutionContext;
describe("Cloudflare MCP entrypoint", () => {
  it("exposes a health endpoint without a DB connection", async () => {
    const r = await handleRequest(new Request("https://awc.example/health"), env, ctx);
    expect(r.status).toBe(200);
    expect((await r.json() as {paymentMode:string}).paymentMode).toBe("sandbox-only");
  });
  it("does not allow unaudited browser origins", async () => {
    const r = await handleRequest(new Request("https://awc.example/mcp", {
      method:"POST",headers:{"origin":"https://evil.example"},body:"{}",
    }), env, ctx);
    expect(r.status).toBe(403);
  });
  it("fails on spoofed MCP tool routing headers before invocation", async () => {
    const r = await handleRequest(new Request("https://awc.example/mcp", {
      method:"POST",headers:{"mcp-method":"tools/call","mcp-name":"catalog.search"},
      body:JSON.stringify({jsonrpc:"2.0",method:"tools/call",params:{name:"quotes.request",arguments:{}},id:1}),
    }), env, ctx);
    expect(r.status).toBe(400);
  });
});
