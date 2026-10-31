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
    expect((await r.json() as {livePayments:boolean}).livePayments).toBe(false);
  });
  it("never allows agent credentials to approve a human contract",async()=>{
    const r=await handleRequest(new Request("http://localhost/api/approve",{
      method:"POST",headers:{"authorization":"Bearer sandbox-buyer-token-never-publish-1234567890","content-type":"application/json"},
      body:JSON.stringify({workId:"work_00000000-0000-0000-0000-000000000000",reviewedDigest:"0".repeat(64)}),
    }),{...env,ENABLE_LOCAL_SANDBOX:"true",
      AWC_BUYER_TOKEN:"sandbox-buyer-token-never-publish-1234567890",
      AWC_SANDBOX_HUMAN_TOKEN:"a-different-human-token-never-publish-123456789"} as Env,ctx);
    expect(r.status).toBe(401);
  });
  it("never permits synthetic funding on a public hostname",async()=>{
    const r=await handleRequest(new Request("https://awc.example/api/dev/fund",{
      method:"POST",headers:{"authorization":"Bearer a-different-human-token-never-publish-123456789",
        "content-type":"application/json"},
      body:JSON.stringify({workId:"work_00000000-0000-0000-0000-000000000000"}),
    }),{...env,ENABLE_LOCAL_SANDBOX:"true",
      AWC_SANDBOX_HUMAN_TOKEN:"a-different-human-token-never-publish-123456789"} as Env,ctx);
    expect(r.status).toBe(401);
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
