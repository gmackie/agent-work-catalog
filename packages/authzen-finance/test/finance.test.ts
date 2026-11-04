import {describe,expect,it} from "vitest";
import {runStandardsScenario} from "@awc/standards-demo";
import {actionToAuthzen,createAuthzenPdp} from "@awc/authzen";
import {createFundedConditionalVerifier} from "../src/index.ts";
import type {TrustedTreasuryLookup} from "../src/index.ts";
describe("AuthZEN conditional financial authority with trusted economic reservation",()=>{
 it("allows a bounded commercial action only when matching durable reservation evidence exists",async()=>{
  const fixture=await runStandardsScenario("vending");
  const p=fixture.simulation.attemptedActions[0]!.proposal;
  const policy=fixture.simulation.trustedPolicyContext;
  const caller={subjectId:p.actorId,clientId:"awc-trusted-pep"};
  const reservation={id:"expense:1",mandateId:p.mandateId,actionId:p.id,
    idempotencyKey:p.id+":"+p.revision,maximumMinor:p.commitment!.maximumMinor,state:"reserved" as const};
  const lookup:TrustedTreasuryLookup={
    account:async()=>({accountId:p.commitment!.accountId,ownerId:fixture.simulation.mandate.principalId,
      currency:"USD",fundedMinor:"10000",spentMinor:"0",reservedMinor:"1800",availableMinor:"8200"}),
    mandate:async()=>({mandateId:p.mandateId,limitMinor:"10000",spentMinor:"0",reservedMinor:"1800",
      delegatedMinor:"0",availableMinor:"8200",revoked:false,closed:false}),
    reservationByAction:async()=>reservation,
  };
  const resolver={resolve:async()=>({proposal:p,policy})};
  const pdp=createAuthzenPdp(resolver,{conditionalVerifier:createFundedConditionalVerifier(lookup)});
  const decision=await pdp.evaluate(actionToAuthzen(p),caller);
  expect(decision.decision).toBe(true);
  const declined=createAuthzenPdp(resolver,{
    conditionalVerifier:createFundedConditionalVerifier({
      ...lookup,reservationByAction:async()=>({...reservation,maximumMinor:"100"})
    })
  });
  expect((await declined.evaluate(actionToAuthzen(p),caller)).decision).toBe(false);
  const used=createAuthzenPdp(resolver,{
    conditionalVerifier:createFundedConditionalVerifier({
      ...lookup,reservationByAction:async()=>({...reservation,state:"captured"})
    })
  });
  expect((await used.evaluate(actionToAuthzen(p),caller)).decision).toBe(false);
  const revoked=createAuthzenPdp(resolver,{
    conditionalVerifier:createFundedConditionalVerifier({
      ...lookup,mandate:async()=>({...await lookup.mandate(p.mandateId),revoked:true})
    })
  });
  expect((await revoked.evaluate(actionToAuthzen(p),caller)).decision).toBe(false);
 });
});
