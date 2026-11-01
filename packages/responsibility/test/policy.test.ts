import { describe,expect,it } from "vitest";
import { assertAttenuated, evaluateAction, mandateChain, type ActionProposal, type OperatingMandate, type PolicyContext } from "../src/index.ts";

const root:OperatingMandate={
 schemaVersion:"awc.operating-mandate/v1",id:"mandate:root",principalId:"org:operator",
 delegateId:"agent:manager",accountablePartyId:"org:operator",operationId:"operation:fleet",
 issuerId:"org:operator",issuedAt:"2026-10-01T00:00:00Z",validFrom:"2026-10-01T00:00:00Z",
 expiresAt:"2026-12-01T00:00:00Z",
 scope:{entityIds:["machine:42","machine:43"],actions:["inventory.replenishment.request","maintenance.schedule","telemetry.read"],
 maximumRisk:"operational",maximumDataClassification:"internal",deniedActions:["plc.write_coil"],
 approvalActions:["maintenance.schedule"],maximumObservationAgeMs:300_000,remainingDelegations:2},
 economics:{accountId:"account:operator",currency:"USD",maxTotalMinor:"200000",maxPerActionMinor:"25000"},
 obligations:[{kind:"metric",id:"objective:availability",metric:"fleet.availability",comparator:">=",target:0.98,windowSeconds:2592000,observationSourceId:"machine:telemetry"}],
};
const proposal:ActionProposal={
 schemaVersion:"awc.action/v1",id:"proposal:restock",revision:"a".repeat(64),mandateId:root.id,
 operationId:root.operationId,actorId:root.delegateId,entityId:"machine:42",
 action:"inventory.replenishment.request",risk:"commercial",dataClassification:"internal",
 requestedAt:"2026-11-01T16:00:00Z",expectedStateVersion:"v1",effects:["purchase"],
 commitment:{accountId:"account:operator",currency:"USD",maximumMinor:"5000",pricingReference:"quote:123"},
};
const trusted=():PolicyContext=>({
 now:"2026-11-01T16:01:00Z",mandates:[root],revokedMandateIds:[],
 ownerPermissions:[{ownerId:"org:machine-owner",granteePrincipalId:root.principalId,entityId:"machine:42",
 actions:["inventory.replenishment.request","maintenance.schedule","telemetry.read"],
 validUntil:"2026-12-01T00:00:00Z"}],
 observation:{entityId:"machine:42",stateVersion:"v1",observedAt:"2026-11-01T16:00:30Z",sourceId:"telemetry"},
 approvals:[],
});
describe("responsibility and mandate policy",()=>{
 it("permits scoped replenishment with current state, independent owner grant and bounded quote",()=>{
   const d=evaluateAction(proposal,trusted());expect(d.kind).toBe("permit-with-conditions");
 });
 it("does not let outcomes create powers: physical-control and safety override always denied",()=>{
   const p={...proposal,action:"plc.write_coil",risk:"physical-control" as const};
   expect(evaluateAction(p,trusted())).toMatchObject({kind:"deny"});
 });
 it("requires owner consent, current state and authorization for the precise subject",()=>{
   expect(evaluateAction(proposal,{...trusted(),ownerPermissions:[]})).toMatchObject({kind:"deny"});
   expect(evaluateAction({...proposal,actorId:"agent:other"},trusted())).toMatchObject({kind:"deny"});
   expect(evaluateAction(proposal,{...trusted(),observation:{entityId:"machine:42",stateVersion:"v1",observedAt:"2026-11-01T14:00:00Z",sourceId:"old"}})).toMatchObject({kind:"deny"});
 });
 it("denies revoked mandates, expired mandates, unbounded purchases or excessive cost",()=>{
   expect(evaluateAction(proposal,{...trusted(),revokedMandateIds:[root.id]})).toMatchObject({kind:"deny"});
   expect(evaluateAction(proposal,{...trusted(),now:"2027-01-01T00:00:00Z"})).toMatchObject({kind:"deny"});
   expect(evaluateAction({...proposal,commitment:undefined},trusted())).toMatchObject({kind:"deny"});
   expect(evaluateAction({...proposal,commitment:{...proposal.commitment!,maximumMinor:"25001"}},trusted())).toMatchObject({kind:"deny"});
 });
 it("escalates maintenance unless separately trusted, revision-bound approval exists",()=>{
   const p:ActionProposal={...proposal,id:"proposal:maintenance",action:"maintenance.schedule",
    risk:"operational",commitment:undefined};
   expect(evaluateAction(p,trusted()).kind).toBe("escalate");
   const d=evaluateAction(p,{...trusted(),approvals:[{approverId:"org:operator",proposalId:p.id,
    revision:p.revision,validUntil:"2026-11-02T00:00:00Z"}]});
   expect(d.kind).toBe("permit-with-conditions");
   expect(evaluateAction({...p,revision:"b".repeat(64)},{
     ...trusted(),approvals:[{approverId:"org:operator",proposalId:p.id,revision:p.revision,
     validUntil:"2026-11-02T00:00:00Z"}],
   }).kind).toBe("escalate");
 });
 it("enforces attenuated delegated authority, delegation actor, time, budget and approval",()=>{
   const child:OperatingMandate={...root,id:"mandate:child",parentId:root.id,issuerId:root.delegateId,
    delegateId:"agent:buyer",validFrom:"2026-10-10T00:00:00Z",expiresAt:"2026-11-20T00:00:00Z",
    scope:{...root.scope,entityIds:["machine:42"],actions:["inventory.replenishment.request"],
      remainingDelegations:1,maximumRisk:"commercial",maximumObservationAgeMs:60_000},
    economics:{...root.economics,maxTotalMinor:"10000",maxPerActionMinor:"5000"}};
   expect(()=>assertAttenuated(child,root)).not.toThrow();
   expect(mandateChain(child.id,[root,child])).toHaveLength(2);
   expect(evaluateAction({...proposal,actorId:child.delegateId,mandateId:child.id},{
     ...trusted(),mandates:[root,child],
   }).kind).toBe("permit-with-conditions");
   expect(()=>assertAttenuated({...child,scope:{...child.scope,entityIds:["machine:99"]}},root)).toThrow();
   expect(()=>assertAttenuated({...child,economics:{...child.economics,maxTotalMinor:"999999"}},root)).toThrow();
   expect(()=>assertAttenuated({...child,scope:{...child.scope,approvalActions:[]},
     },{...root,scope:{...root.scope,approvalActions:["inventory.replenishment.request"]}})).toThrow();
   expect(()=>assertAttenuated({...child,expiresAt:"2027-01-01T00:00:00Z"},root)).toThrow();
 });
 it("detects cycles, missing parents and unbounded delegation",()=>{
   expect(()=>mandateChain("mandate:root",[{...root,parentId:"mandate:root",issuerId:root.delegateId}])).toThrow();
   expect(()=>mandateChain("mandate:root",[{...root,parentId:"missing"}])).toThrow();
 });
});
