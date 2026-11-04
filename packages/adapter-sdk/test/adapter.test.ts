import { describe,expect,it } from "vitest";
import { Effect } from "effect";
import { adapterRegistryLayer, inspectThingDescription, validateAdapterManifest,
 type AdapterManifest } from "../src/managed-systems.ts";
const manifest:AdapterManifest={
 schemaVersion:"awc.managed-adapter/v1",id:"example:vending",version:"1",name:"Vending observation",
 role:"managed-system",transport:"remote-read-only",entityKinds:["vending-machine"],
 capabilities:[{id:"telemetry.read",effect:"read",requiresIndependentApproval:false}],
};
describe("managed system adapter conformance",()=>{
 it("accepts a read-only observation manifest and rejects misleading mutation claims",()=>{
  expect(()=>validateAdapterManifest(manifest)).not.toThrow();
  expect(()=>validateAdapterManifest({...manifest,capabilities:[...manifest.capabilities,
   {id:"plc.write_coil",effect:"physical-control",requiresIndependentApproval:false}]})).toThrow();
  expect(()=>validateAdapterManifest({...manifest,capabilities:[
   {...manifest.capabilities[0]!}, {...manifest.capabilities[0]!}]})).toThrow();
 });
 it("does not turn WoT action affordances into permissions",()=>{
  const info=inspectThingDescription({
   id:"urn:machine:42",properties:{temperature:{}},
   actions:{resetCompressor:{},dispense:{}},events:{temperatureAlarm:{}},
  });
  expect(info.actions.every(a=>a.authority==="not-granted")).toBe(true);
  expect(info.properties).toContain("temperature");
  expect(info.events).toContain("temperatureAlarm");
 });
 it("rejects an adapter that implements a write port while advertising read-only",()=>{
  expect(()=>adapterRegistryLayer([{
   manifest,describe:()=>Effect.succeed([]),observe:()=>Effect.fail(new Error() as any),
   submitApprovedAction:()=>Effect.fail(new Error() as any),
  }])).toThrow();
 });
});
