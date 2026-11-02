import {describe,expect,it} from "vitest";
import {authorizeToolCall,mapToolCall,mapReviewedToolCall,AWC_REVIEWED_TOOL_MAPPINGS} from "../src/index.ts";
const caller={subjectId:"agent:buyer",clientId:"client:agent",audience:"https://awc.example/mcp"};
const invoke=(name:string)=>({method:"tools/call" as const,params:{name,arguments:{workId:"work:123"}}});
const policy=[{name:"catalog.search",requiresObjectDecision:false},
 {name:"work.start",requiredScope:"work:execute",requiresObjectDecision:true}];
describe("COAZ-MCP draft subset / safe tool PEP",()=>{
 it("builds spec default binding anchored to verified token subject",()=>{
  expect(mapToolCall(invoke("catalog.search"),caller)).toEqual({
    subject:{type:"identity",id:"agent:buyer"},
    action:{name:"tools/call"},resource:{type:"tool",id:"catalog.search"},
    context:{agent:"client:agent"},
  });
 });
 it("permits reviewed read tools only after PDP allow",async()=>{
  const allowed=await authorizeToolCall(invoke("catalog.search"),caller,policy,[],async()=>({decision:true}));
  expect(allowed.decision).toBe(true);
 });
 it("fails closed for unknown tools, missing scope, PDP denial/outage and object-sensitive writes",async()=>{
  const allow=async()=>({decision:true});
  await expect(authorizeToolCall(invoke("mystery.delete"),caller,policy,[],allow)).rejects.toThrow();
  await expect(authorizeToolCall(invoke("work.start"),caller,policy,[],allow)).rejects.toThrow();
  await expect(authorizeToolCall(invoke("work.start"),caller,policy,["work:execute"],allow)).rejects.toThrow();
  await expect(authorizeToolCall(invoke("catalog.search"),caller,policy,[],async()=>({decision:false}))).rejects.toThrow();
  await expect(authorizeToolCall(invoke("catalog.search"),caller,policy,[],async()=>{throw Error("timeout")})).rejects.toThrow();
 });
});

describe("reviewed COAZ-MCP tool-to-resource binding",()=>{
 const actor={...caller,subjectId:"principal:https%3A%2F%2Fissuer.example:sub:agent-1"};
 it("maps a work target to canonical Gatekeeper action/resource while preserving verified subject",()=>{
  const request=mapReviewedToolCall(invoke("work.get"),actor,AWC_REVIEWED_TOOL_MAPPINGS);
  expect(request).toEqual({
   subject:{type:"identity",id:actor.subjectId},
   action:{name:"awc.work.read"},
   resource:{type:"gatekeeper-resource",id:"work:one".replace("one","123")},
   context:{purpose:"awc-mcp:work.get"},
  });
 });
 it("fails closed when arguments, tool, or reviewed rule are missing or conflicting",()=>{
  const fn=(name:string,args:Record<string,unknown>)=>mapReviewedToolCall(
    {method:"tools/call",params:{name,arguments:args}},actor,AWC_REVIEWED_TOOL_MAPPINGS);
  expect(()=>fn("work.get",{})).toThrow();
  expect(()=>fn("not-reviewed",{workId:"work:123"})).toThrow();
  expect(()=>fn("work.get",{workId:{id:"work:123"}})).toThrow();
  expect(()=>mapReviewedToolCall(invoke("work.get"),actor,
    [...AWC_REVIEWED_TOOL_MAPPINGS,AWC_REVIEWED_TOOL_MAPPINGS[2]!])).toThrow();
 });
});
