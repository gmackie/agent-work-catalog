import { describe,expect,it } from "vitest";
import { Effect } from "effect";
import { makeSimulatedEconomicLedger } from "@awc/economics";
import { sealActionProposal, type ActionProposal, type OperatingMandate, type OwnerPermission } from "@awc/responsibility";
import { makeSimulatedOperations, assessObligations } from "../src/index.ts";
import { createSimulatedEnvironment } from "../src/simulated.ts";

const run=<T>(effect:Effect.Effect<T,any>)=>Effect.runPromise(effect);
const timestamp="2026-11-01T18:00:00Z";
const mandate=(kind:"vending-machine"|"cloud-service"|"production-cell",actions:string[]):OperatingMandate=>({
 schemaVersion:"awc.operating-mandate/v1",id:"mandate:"+kind,principalId:"org:operator",
 delegateId:"agent:manager",accountablePartyId:"org:operator",
 operationId:"operation:"+kind,issuerId:"org:operator",issuedAt:"2026-10-31T00:00:00Z",
 validFrom:"2026-10-31T00:00:00Z",expiresAt:"2026-12-01T00:00:00Z",
 scope:{entityIds:["entity:"+kind],actions:actions.filter(x=>x!=="plc.write_coil"),maximumRisk:"operational",
 maximumDataClassification:"internal",deniedActions:["plc.write_coil"],
 approvalActions:["production.schedule.propose"],maximumObservationAgeMs:300_000,remainingDelegations:1},
 economics:{accountId:"account:"+kind,currency:"USD",maxTotalMinor:"10000",maxPerActionMinor:"5000"},
 obligations:[{kind:"metric",id:"objective:uptime",metric:"availability",comparator:">=",
  target:0.98,windowSeconds:3600,observationSourceId:"simulated:"+kind}],
});
const proposal=(m:OperatingMandate,kind:OperatingMandate["id"],action:string,cost?:string):ActionProposal=>({
 schemaVersion:"awc.action/v1",id:"proposal:"+action,revision:"a".repeat(64),
 mandateId:m.id,operationId:m.operationId,actorId:m.delegateId,entityId:"entity:"+kind,
 action,risk:cost?"commercial":"operational",dataClassification:"internal",
 requestedAt:timestamp,expectedStateVersion:"state:0",effects:cost?["purchase"]:["business-work-order"],
 ...(cost?{commitment:{accountId:m.economics.accountId,currency:"USD",maximumMinor:cost,
 pricingReference:"quote:simulated"}}:{}),
});
async function fixture(kind:"vending-machine"|"cloud-service"|"production-cell",actions:string[]){
 const m=mandate(kind,actions),ledger=makeSimulatedEconomicLedger();
 await run(ledger.seedSimulatedAccount({accountId:m.economics.accountId,ownerId:m.principalId,
 currency:"USD",fundedMinor:"8000"}));
 await run(ledger.registerMandate(m));
 const policies=actions.map(action=>({
  entityId:"entity:"+kind,action,
  risk:action==="plc.write_coil"?"physical-control" as const:
    action==="inventory.replenishment.request"||action==="capacity.acquire"?"commercial" as const:
    action==="telemetry.read"?"observe" as const:"operational" as const,
  allowedEffects:action==="inventory.replenishment.request"||action==="capacity.acquire"?
    ["purchase"]:["business-work-order"],
 }));
 const env=createSimulatedEnvironment({id:"entity:"+kind,kind,ownerId:"org:asset-owner",
 operationalPrincipalId:m.principalId,actions,actionPolicies:policies},
 {availability:0.95,stockRemaining:3,requestRate:150,throughput:850},timestamp);
 const grants:OwnerPermission[]=[{ownerId:"org:asset-owner",granteePrincipalId:m.principalId,
 entityId:env.entity.id,actions,validUntil:"2026-12-01T00:00:00Z"}];
 return {m,ledger,env,controller:makeSimulatedOperations(env,m,[m],grants,ledger)};
}
describe("common operational mandate across simulated industries",()=>{
 it("vending agent commissions replenishment within shared spending authority",async()=>{
  const f=await fixture("vending-machine",["inventory.replenishment.request","telemetry.read"]);
  const p=await sealActionProposal(proposal(f.m,"vending-machine","inventory.replenishment.request","2400"));
  const first=await run(f.controller.commit(p,timestamp));
  expect(first.simulation).toBe(true);expect(first.chargedMinor).toBe("2400");
  await expect(run(f.controller.commit({...p,action:"maintenance.ticket.create"},timestamp))).rejects.toMatchObject({code:"invalid_proposal"});
  expect(f.env.snapshot().restockOrders).toBe(1);
  const replay=await run(f.controller.commit(p,timestamp));
  expect(replay.eventId).toBe(first.eventId);
  expect(f.env.snapshot().restockOrders).toBe(1);
  expect((await run(f.ledger.account(f.m.economics.accountId))).spentMinor).toBe("2400");
 });
 it("cloud agent reserves compute capacity without accessing real provider credentials",async()=>{
  const f=await fixture("cloud-service",["capacity.acquire","capacity.release"]);
  await run(f.controller.commit(await sealActionProposal(proposal(f.m,"cloud-service","capacity.acquire","1500")),timestamp));
  expect(f.env.snapshot().reservedComputeUnits).toBe(1);
  expect((await run(f.ledger.account(f.m.economics.accountId))).availableMinor).toBe("6500");
 });
 it("plant schedules require independent approval and cannot bypass equipment safety",async()=>{
  const f=await fixture("production-cell",["production.schedule.propose","maintenance.ticket.create","plc.write_coil"]);
  const p=await sealActionProposal(proposal(f.m,"production-cell","production.schedule.propose"));
  await expect(run(f.controller.commit(p,timestamp))).rejects.toMatchObject({code:"approval_required"});
  const write={...p,action:"plc.write_coil",risk:"physical-control" as const};
  expect((await run(f.controller.evaluate(write,timestamp))).kind).toBe("deny");
  expect(f.env.snapshot().scheduleProposals).toBeUndefined();
 });
 it("rejects stale device state and never spends on rejected action",async()=>{
  const f=await fixture("vending-machine",["inventory.replenishment.request"]);
  const p=await sealActionProposal(proposal(f.m,"vending-machine","inventory.replenishment.request","5000"));
  await expect(run(f.controller.commit(await sealActionProposal({...p,expectedStateVersion:"state:other"}),timestamp))).rejects.toThrow();
  expect((await run(f.ledger.account(f.m.economics.accountId))).spentMinor).toBe("0");
 });
 it("measures a declared objective only from its authoritative, fresh source",()=>{
  const m=mandate("vending-machine",["telemetry.read"]);
  expect(assessObligations(m,[],timestamp)[0]?.status).toBe("unknown");
  expect(assessObligations(m,[{metric:"availability",sourceId:"untrusted",value:1,
   windowSeconds:3600,observedAt:timestamp}],timestamp)[0]?.status).toBe("unknown");
  expect(assessObligations(m,[{metric:"availability",sourceId:"simulated:vending-machine",
   value:0.95,windowSeconds:3600,observedAt:timestamp}],timestamp)[0]?.status).toBe("breached");
 });
});
