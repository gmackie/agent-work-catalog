import { describe,expect,it } from "vitest";
import { actionToAuthzen,authzenMetadata,createAuthzenPdp,parseAuthzenEvaluation } from "../src/index.ts";
import { sealActionProposal } from "@awc/responsibility";
import type { ActionProposal, OperatingMandate, PolicyContext } from "@awc/responsibility";
const TIME="2026-11-01T16:00:00Z";
const mandate:OperatingMandate={
 schemaVersion:"awc.operating-mandate/v1",id:"mandate:a",principalId:"org:o",
 delegateId:"agent:manager",accountablePartyId:"org:o",operationId:"op:a",issuerId:"org:o",
 issuedAt:"2026-10-01T00:00:00Z",validFrom:"2026-10-01T00:00:00Z",expiresAt:"2026-12-01T00:00:00Z",
 scope:{entityIds:["entity:a"],actions:["telemetry.read","capacity.acquire"],maximumRisk:"commercial",
  maximumDataClassification:"internal",deniedActions:[],approvalActions:[],
  maximumObservationAgeMs:60000,remainingDelegations:0},
 economics:{accountId:"account:a",currency:"USD",maxTotalMinor:"10000",maxPerActionMinor:"5000"},obligations:[],
};
const make = async (action:"telemetry.read"|"capacity.acquire")=>{
  const raw:ActionProposal={schemaVersion:"awc.action/v1",id:"proposal:"+action,revision:"0".repeat(64),
    mandateId:mandate.id,operationId:mandate.operationId,actorId:mandate.delegateId,entityId:"entity:a",
    action,risk:action==="telemetry.read"?"observe":"commercial",dataClassification:"internal",
    requestedAt:TIME,effects:action==="telemetry.read"?[]:["purchase"],
    ...(action==="capacity.acquire"?{
      expectedStateVersion:"s1",commitment:{accountId:"account:a",currency:"USD",
       maximumMinor:"1000",pricingReference:"quote:a"}
    }:{})};
  const proposal=await sealActionProposal(raw);
  const context:PolicyContext={now:TIME,mandates:[mandate],revokedMandateIds:[],
    assetOwnerId:"org:asset-owner",
    ownerPermissions:[{ownerId:"org:asset-owner",granteePrincipalId:"org:o",entityId:"entity:a",
      actions:["telemetry.read","capacity.acquire"],validUntil:"2026-12-01T00:00:00Z"}],
    actionPolicies:[{entityId:"entity:a",action:"telemetry.read",risk:"observe",allowedEffects:[]},
      {entityId:"entity:a",action:"capacity.acquire",risk:"commercial",allowedEffects:["purchase"]}],
    observation:{entityId:"entity:a",observedAt:TIME,sourceId:"asset",stateVersion:"s1"},approvals:[]};
  return {proposal,context};
};
const ACTOR={subjectId:"agent:manager",clientId:"agent-client"};
describe("AuthZEN 1.0 AWC policy adapter",()=>{
 it("allows scoped read and publishes correct PDP metadata",async()=>{
  const fixture=await make("telemetry.read");
  const pdp=createAuthzenPdp({resolve:async()=>({proposal:fixture.proposal,policy:fixture.context})});
  const result=await pdp.evaluate(actionToAuthzen(fixture.proposal),ACTOR);
  expect(result.decision).toBe(true);
  expect(authzenMetadata("https://pdp.example")).toEqual({
    policy_decision_point:"https://pdp.example",
    access_evaluation_endpoint:"https://pdp.example/access/v1/evaluation",
  });
 });
 it("denies conditional writes pending independent commit and funding",async()=>{
  const {proposal,context}=await make("capacity.acquire");
  const pdp=createAuthzenPdp({resolve:async()=>({proposal,policy:context})});
  const result=await pdp.evaluate(actionToAuthzen(proposal),ACTOR);
  expect(result.decision).toBe(false);
  expect(result.context?.awc_decision_kind).toBe("permit-with-conditions");
 });

 it("allows conditional purchases ONLY after a trusted exact-revision authorization",async()=>{
  const {proposal,context}=await make("capacity.acquire");
  const resolver={resolve:async()=>({proposal,policy:context})};
  const verified={proposalId:proposal.id,revision:proposal.revision,
    actorId:proposal.actorId,entityId:proposal.entityId,action:proposal.action,
    expiresAt:"2026-11-01T16:00:30Z"};
  const pdp=createAuthzenPdp(resolver,{conditionalVerifier:{verify:async()=>verified}});
  const decision=await pdp.evaluate(actionToAuthzen(proposal),ACTOR);
  expect(decision.decision).toBe(true);
  expect(decision.context?.awc_decision_kind).toBe("verified-conditional-authorization");
  const forged=createAuthzenPdp(resolver,{conditionalVerifier:{verify:async()=>({
    ...verified,revision:"f".repeat(64)
  })}});
  expect((await forged.evaluate(actionToAuthzen(proposal),ACTOR)).decision).toBe(false);
  const expired=createAuthzenPdp(resolver,{conditionalVerifier:{verify:async()=>({
    ...verified,expiresAt:"2026-11-01T15:59:59Z"
  })}});
  expect((await expired.evaluate(actionToAuthzen(proposal),ACTOR)).decision).toBe(false);
  const down=createAuthzenPdp(resolver,{conditionalVerifier:{verify:async()=>{throw Error("down");}}});
  expect((await down.evaluate(actionToAuthzen(proposal),ACTOR)).decision).toBe(false);
 });
 it("fails closed on forged caller, resource, scope, revision and unknown proposal",async()=>{
  const {proposal,context}=await make("telemetry.read");
  const pdp=createAuthzenPdp({resolve:async()=>({proposal,policy:context})});
  const base=actionToAuthzen(proposal);
  expect((await pdp.evaluate(base,{subjectId:"attacker",clientId:"evil"})).decision).toBe(false);
  expect((await pdp.evaluate({...base,resource:{type:"awc-managed-entity",id:"entity:b"}},ACTOR)).decision).toBe(false);
  expect((await pdp.evaluate({...base,action:{name:"capacity.acquire"}},ACTOR)).decision).toBe(false);
  expect((await pdp.evaluate({...base,context:{awc_proposal_id:proposal.id,awc_proposal_revision:"f".repeat(64)}},ACTOR)).decision).toBe(false);
  const none=createAuthzenPdp({resolve:async()=>undefined});
  expect((await none.evaluate(base,ACTOR)).decision).toBe(false);
 });
 it("doesn't let client-supplied context overwrite trusted permissions or observations",async()=>{
  const {proposal,context}=await make("telemetry.read");
  const pdp=createAuthzenPdp({resolve:async()=>({proposal,policy:{...context,revokedMandateIds:[mandate.id]}})});
  const base=actionToAuthzen(proposal);
  expect((await pdp.evaluate(base,ACTOR)).decision).toBe(false);
  expect(()=>parseAuthzenEvaluation({...base,context:{...base.context,mandates:[mandate]}})).toThrow();
 });
});
