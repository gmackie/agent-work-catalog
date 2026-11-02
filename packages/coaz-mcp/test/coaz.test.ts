import {describe,expect,it} from "vitest";
import {authorizeToolCall,mapToolCall} from "../src/index.ts";
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
