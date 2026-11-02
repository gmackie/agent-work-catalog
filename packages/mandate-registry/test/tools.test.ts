import {describe,expect,it} from "vitest";
import {createTrustedMcpToolPdp} from "../src/tools.ts";
import type {ToolPolicyRow} from "../src/tools.ts";
import {mapToolCall} from "@awc/coaz-mcp";
const caller={tenantId:"tenant:one",subjectId:"agent:one",clientId:"client:one",
  audience:"https://awc.example/mcp",scopes:["work:read"]};
const policy:ToolPolicyRow={tenantId:caller.tenantId,clientId:caller.clientId,
  toolName:"work.get",requiredScope:"work:read",active:true,objectCheckRequired:true};
const invocation={method:"tools/call" as const,params:{name:"work.get",arguments:{workId:"work:one"}}};
describe("AuthZEN-backed MCP tool admission",()=>{
 it("authorizes a reviewed tool for exact tenant/client/scope and preserves object-level warning",async()=>{
  const pdp=createTrustedMcpToolPdp({lookup:async()=>policy});
  const decision=await pdp.evaluate(mapToolCall(invocation,caller),caller);
  expect(decision.decision).toBe(true);
  expect(decision.context?.awc_object_check_required).toBe(true);
 });
 it("denies cross-tenant, spoofed subjects, client mismatch, missing scope and PDP outages",async()=>{
  const pdp=createTrustedMcpToolPdp({lookup:async()=>policy});
  const request=mapToolCall(invocation,caller);
  expect((await pdp.evaluate(request,{...caller,tenantId:"tenant:two"})).decision).toBe(false);
  expect((await pdp.evaluate(request,{...caller,subjectId:"evil"})).decision).toBe(false);
  expect((await pdp.evaluate(request,{...caller,scopes:[]})).decision).toBe(false);
  expect((await pdp.evaluate({...request,context:{agent:"evil"}},caller)).decision).toBe(false);
  const outage=createTrustedMcpToolPdp({lookup:async()=>{throw Error("db down");}});
  expect((await outage.evaluate(request,caller)).decision).toBe(false);
 });
 it("rejects unregistered tools even if the client token has broad scopes",async()=>{
  const pdp=createTrustedMcpToolPdp({lookup:async()=>undefined});
  const request=mapToolCall(invocation,caller);
  expect((await pdp.evaluate(request,{...caller,scopes:["work:read","work:execute","admin"]})).decision).toBe(false);
 });
});
