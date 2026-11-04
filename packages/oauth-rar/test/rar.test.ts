import {describe,expect,it} from "vitest";
import {sealActionProposal} from "@awc/responsibility";
import type {ActionProposal} from "@awc/responsibility";
import {AWC_RAR_TYPE,createActionAuthorizationDetail,assertExactRarGrant,encodeRarAuthorizationDetails} from "../src/index.ts";
const action:ActionProposal={
 schemaVersion:"awc.action/v1",id:"proposal:restock",revision:"0".repeat(64),
 mandateId:"mandate:fleet",operationId:"operation:vending",
 actorId:"agent:procurement",entityId:"machine:042",
 action:"inventory.replenishment.request",risk:"commercial",dataClassification:"internal",
 requestedAt:"2026-11-01T12:00:00Z",effects:["purchase"],expectedStateVersion:"v3",
 commitment:{accountId:"account:operator",currency:"USD",maximumMinor:"2500",pricingReference:"quote:v4"}
};
describe("RFC 9396 exact AWC transaction authorization detail",()=>{
 it("projects a signed-format-bound proposal into RAR and compares trusted grant fields exactly",async()=>{
  const p=await sealActionProposal(action);
  const detail=await createActionAuthorizationDetail(p,"https://gateway.example");
  expect(detail.type).toBe(AWC_RAR_TYPE);
  expect(detail.locations).toEqual(["https://gateway.example"]);
  expect(detail.awc_maximum_minor).toBe("2500");
  expect(JSON.parse(encodeRarAuthorizationDetails(detail))[0]).toEqual(detail);
  expect(()=>assertExactRarGrant(detail,JSON.parse(JSON.stringify(detail)))).not.toThrow();
 });
 it("rejects changed actor, amount, resource, extra privileges and stale action digest",async()=>{
  const p=await sealActionProposal(action);
  const d=await createActionAuthorizationDetail(p,"https://gateway.example");
  for(const change of [
   {...d,awc_maximum_minor:"25000"},{...d,awc_actor_id:"agent:other"},
   {...d,locations:["https://evil.example"]},{...d,actions:["inventory.replenishment.request","admin"]},
   {...d,extra:"admin"}
  ])expect(()=>assertExactRarGrant(d,change)).toThrow();
  await expect(createActionAuthorizationDetail({...p,action:"inventory.delete"},"https://gateway.example")).rejects.toThrow();
  await expect(createActionAuthorizationDetail(p,"http://169.254.169.254")).rejects.toThrow();
 });
});
