import {describe,expect,it} from "vitest";
import {runStandardsScenario} from "@awc/standards-demo";
import {actionToAuthzen} from "@awc/authzen";
import {createRegistryBackedPdp,createStaticTrustedRegistry} from "../src/index.ts";
import {d1TrustedMandateRegistry,type D1Database} from "../src/d1.ts";
const caller={tenantId:"tenant:a",subjectId:"agent:demo-manager",clientId:"awc-test-pep"};
async function samples(){
 const s=await runStandardsScenario("vending");
 const read=s.syntheticReadProposal;
 const restock=s.simulation.attemptedActions[0]!.proposal;
 const ctx=s.simulation.trustedPolicyContext;
 return {read,restock,ctx};
}
describe("Tenant-scoped trusted mandate source",()=>{
 it("authorizes only independently registered, actor-bound read proposals",async()=>{
  const {read,restock,ctx}=await samples();
  const registry=createStaticTrustedRegistry([
    {tenantId:"tenant:a",proposal:read,policy:ctx},
    {tenantId:"tenant:a",proposal:restock,policy:ctx},
  ]);
  const pdp=createRegistryBackedPdp(registry);
  expect((await pdp.evaluate(actionToAuthzen(read),caller)).decision).toBe(true);
  const write=await pdp.evaluate(actionToAuthzen(restock),caller);
  expect(write.decision).toBe(false);
  expect(write.context?.awc_decision_kind).toBe("permit-with-conditions");
  expect((await pdp.evaluate(actionToAuthzen(read),{...caller,tenantId:"tenant:b"})).decision).toBe(false);
  expect((await pdp.evaluate(actionToAuthzen(read),{...caller,subjectId:"attacker"})).decision).toBe(false);
 });
 it("denies a tampered or revoked mandate, forged owner, or false asset state",async()=>{
  const {read,ctx}=await samples();
  const bad=[{...ctx,revokedMandateIds:[ctx.mandates[0]!.id]},
    {...ctx,assetOwnerId:"org:attacker"},
    {...ctx,mandates:[{...ctx.mandates[0]!,issuerId:"wrong-issuer"}]},
  ];
  for(const policy of bad){
    const registry=createStaticTrustedRegistry([{tenantId:"tenant:a",proposal:read,policy}]);
    const result=await createRegistryBackedPdp(registry).evaluate(actionToAuthzen(read),caller);
    expect(result.decision).toBe(false);
  }
 });
 it("reads only tenant-scoped immutable D1 rows and denies unregistered tenants",async()=>{
  const {read,ctx}=await samples();
  const queries:{sql:string;params:unknown[]}[]=[];
  const db:D1Database={prepare(sql){
    const params:unknown[]=[];
    return {
      bind(...values){params.push(...values);return this;},
      async first<T>(){
        queries.push({sql,params:[...params]});
        if(params[0]!=="tenant:a")return null;
        if(sql.includes("awc_trusted_proposals"))return {
          tenant_id:"tenant:a",proposal_id:read.id,actor_id:read.actorId,
          operation_id:read.operationId,entity_id:read.entityId,payload:JSON.stringify(read),
        } as T;
        if(sql.includes("awc_trusted_mandates"))return {
          tenant_id:"tenant:a",id:ctx.mandates[0]!.id,payload:JSON.stringify(ctx.mandates[0]),revoked_at:null
        } as T;
        if(sql.includes("awc_trusted_entities"))return {
          owner_id:ctx.assetOwnerId,observation_version:ctx.observation?.stateVersion??null,
          observed_at:ctx.observation?.observedAt??null,
          observation_source_id:ctx.observation?.sourceId??null,
        } as T;
        return null;
      },
      async all<T>(){
        queries.push({sql,params:[...params]});
        if(params[0]!=="tenant:a")return {results:[] as T[]};
        if(sql.includes("awc_trusted_action_policies"))return {results:ctx.actionPolicies.map(a=>({
          action:a.action,risk:a.risk,effects_json:JSON.stringify(a.allowedEffects)
        })) as T[]};
        if(sql.includes("awc_trusted_owner_grants"))return {results:ctx.ownerPermissions.map(p=>({
          owner_id:p.ownerId,principal_id:p.granteePrincipalId,entity_id:p.entityId,
          actions_json:JSON.stringify(p.actions),valid_until:p.validUntil,
        })) as T[]};
        if(sql.includes("awc_trusted_approvals"))return {results:[] as T[]};
        return {results:[] as T[]};
      }
    };
  }};
  const reg=d1TrustedMandateRegistry(db,()=>Date.parse(ctx.now));
  const result=await reg.resolve("tenant:a",read.id,read.actorId);
  expect(result?.proposal.id).toBe(read.id);
  expect(queries.every(q=>q.sql.includes("tenant_id=?")&&q.params[0]==="tenant:a")).toBe(true);
  expect(await reg.resolve("tenant:b",read.id,read.actorId)).toBeUndefined();
 });
});
