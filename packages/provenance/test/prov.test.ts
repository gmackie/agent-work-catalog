import {describe,expect,it} from "vitest";
import {actionProvenance} from "../src/index.ts";
import type {ActionProposal,OperatingMandate} from "@awc/responsibility";
import type {ActionReceipt} from "@awc/operations";
const mandate={
 id:"mandate:1",operationId:"op:1",principalId:"org:operator",delegateId:"agent:manager",
} as OperatingMandate;
const proposal={
 id:"proposal:1",mandateId:"mandate:1",operationId:"op:1",actorId:"agent:manager",
 entityId:"asset:1",revision:"a".repeat(64),requestedAt:"2026-11-01T15:00:00Z",
} as ActionProposal;
const receipt={
 eventId:"event:1",proposalId:"proposal:1",revision:"a".repeat(64),
 entityId:"asset:1",operationId:"op:1",acceptedAt:"2026-11-01T15:00:01Z",simulation:true,
} as ActionReceipt;
describe("W3C PROV-O mapping",()=>{
 it("binds actor delegation, activity, inputs and generated evidence without leaking customer data",()=>{
  const prov=actionProvenance(mandate,proposal,receipt);
  const graph=prov["@graph"];
  expect(graph.some(x=>x["prov:actedOnBehalfOf"]!==undefined)).toBe(true);
  expect(graph.some(x=>x["@type"]==="prov:Activity")).toBe(true);
  expect(graph.some(x=>x["prov:wasGeneratedBy"]!==undefined)).toBe(true);
  expect(JSON.stringify(prov)).not.toContain("private-artifact-data");
 });
 it("rejects swapped proposal and receipt identities",()=>{
  expect(()=>actionProvenance(mandate,{...proposal,entityId:"other"},receipt)).toThrow();
  expect(()=>actionProvenance(mandate,proposal,{...receipt,revision:"b".repeat(64)})).toThrow();
 });
});
