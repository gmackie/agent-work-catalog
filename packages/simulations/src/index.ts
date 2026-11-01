import { Effect } from "effect";
import { sealActionProposal, type ActionProposal, type OperatingMandate, type OwnerPermission, type PolicyDecision } from "@awc/responsibility";
import { makeSimulatedEconomicLedger } from "@awc/economics";
import { makeSimulatedOperations, assessObligations, type ActionReceipt, type OperationEvent } from "@awc/operations";
import { createSimulatedEnvironment } from "@awc/operations/simulated";
import { recommendOperationalWork, type PlannedOperationalWork } from "@awc/operations/planner";

export const SCENARIOS=[
 {id:"vending",title:"Vending machine: low stock",description:"Commission replenishment within a delegated monthly budget"},
 {id:"cloud",title:"Cloud service: capacity pressure",description:"Procure additional simulated compute without exceeding funded capacity"},
 {id:"plant",title:"Production cell: downtime",description:"Issue a permitted maintenance ticket; escalate schedule changes; deny raw PLC control"},
] as const;
export type ScenarioId=typeof SCENARIOS[number]["id"];
export interface SimulationAttempt {
 readonly action:string;readonly risk:string;
 readonly decision:PolicyDecision;
 readonly status:"simulated"|"escalated"|"denied";
 readonly receipt?:ActionReceipt;
 readonly error?:string;
}
export interface SimulationReport {
 readonly version:"awc.simulation/v1";
 readonly scenario:ScenarioId;
 readonly mode:"strictly-simulated";
 readonly managedEntityId:string;
 readonly mandateId:string;
 readonly before:Readonly<Record<string,number>>;
 readonly after:Readonly<Record<string,number>>;
 readonly account:{readonly fundedMinor:string;readonly spentMinor:string;readonly reservedMinor:string;readonly availableMinor:string};
 readonly obligations:ReturnType<typeof assessObligations>;
 readonly attemptedActions:readonly SimulationAttempt[];
 readonly events:readonly OperationEvent[];
 readonly nextReconciliation:readonly PlannedOperationalWork[];
 readonly note:string;
}
const NOW="2026-11-01T18:00:00Z";
const profile={
 vending:{kind:"vending-machine" as const,
  actions:["telemetry.read","inventory.replenishment.request","maintenance.ticket.create"],
  intent:[{action:"inventory.replenishment.request",risk:"commercial" as const,cost:"1800"}],
  metrics:{availability:0.95,stockRemaining:2,salesPerDay:30}},
 cloud:{kind:"cloud-service" as const,
  actions:["telemetry.read","capacity.acquire","capacity.release","incident.ticket.create"],
  intent:[{action:"capacity.acquire",risk:"commercial" as const,cost:"3500"}],
  metrics:{availability:0.965,requestRate:1450,latencyMs:425,reservedComputeUnits:0}},
 plant:{kind:"production-cell" as const,
  actions:["telemetry.read","maintenance.ticket.create","production.schedule.propose","plc.write_coil"],
  intent:[
   {action:"maintenance.ticket.create",risk:"operational" as const,cost:undefined},
   {action:"production.schedule.propose",risk:"operational" as const,cost:undefined},
   {action:"plc.write_coil",risk:"physical-control" as const,cost:undefined},
  ],
  metrics:{availability:0.92,throughput:780,scrapRate:0.018}},
};
export function runScenario(id:ScenarioId):Effect.Effect<SimulationReport,Error>{
 return Effect.gen(function*(){
  const p=profile[id];
  const entityId="demo:"+id+":001";
  const m:OperatingMandate={
   schemaVersion:"awc.operating-mandate/v1",id:"mandate:demo:"+id,
   principalId:"org:demo-operator",delegateId:"agent:demo-manager",
   accountablePartyId:"org:demo-operator",operationId:"operation:demo:"+id,
   issuerId:"org:demo-operator",issuedAt:"2026-10-30T00:00:00Z",
   validFrom:"2026-10-30T00:00:00Z",expiresAt:"2026-11-30T00:00:00Z",
   scope:{entityIds:[entityId],actions:p.actions.filter(x=>x!=="plc.write_coil"),maximumRisk:"operational",
    maximumDataClassification:"internal",deniedActions:["plc.write_coil","safety.override"],
    approvalActions:["production.schedule.propose"],maximumObservationAgeMs:300_000,
    remainingDelegations:1},
   economics:{accountId:"account:demo:"+id,currency:"USD",
    maxTotalMinor:"6000",maxPerActionMinor:"5000"},
   obligations:[{kind:"metric",id:"objective:availability",metric:"availability",comparator:">=",
    target:0.98,windowSeconds:3600,observationSourceId:"simulated:"+p.kind}],
  };
  const ledger=makeSimulatedEconomicLedger();
  yield* ledger.seedSimulatedAccount({accountId:m.economics.accountId,ownerId:m.principalId,
   currency:"USD",fundedMinor:"6000"});
  yield* ledger.registerMandate(m);

  const actionPolicies=p.actions.map(action=>({
   entityId,action,
   risk:action==="plc.write_coil"?"physical-control" as const:
    action==="capacity.acquire"||action==="inventory.replenishment.request"?"commercial" as const:
    action==="telemetry.read"?"observe" as const:"operational" as const,
   allowedEffects:action==="capacity.acquire"||action==="inventory.replenishment.request"?
    ["purchase"]:["business-work-order"],
  }));

  const env=createSimulatedEnvironment({
   id:entityId,kind:p.kind,ownerId:"org:asset-owner",
   operationalPrincipalId:m.principalId,actions:p.actions,actionPolicies},p.metrics,NOW);
  const before=env.snapshot();
  const ownerPermissions:OwnerPermission[]=[{ownerId:"org:asset-owner",
   granteePrincipalId:m.principalId,entityId,actions:p.actions,validUntil:"2026-12-01T00:00:00Z"}];
  const controller=makeSimulatedOperations(env,m,[m],ownerPermissions,ledger);
  const attempts:SimulationAttempt[]=[];
  for(const [index,action] of p.intent.entries()){
   const observation=yield* controller.inspect(NOW);
   const raw:ActionProposal={
    schemaVersion:"awc.action/v1",id:"proposal:demo:"+id+":"+index,
    revision:(index+1).toString(16).padStart(64,"0"),mandateId:m.id,operationId:m.operationId,
    actorId:m.delegateId,entityId,action:action.action,risk:action.risk,
    dataClassification:"internal",requestedAt:NOW,
    expectedStateVersion:observation.stateVersion,
    effects:action.risk==="commercial"?["purchase"]:["business-work-order"],
    ...(action.cost?{commitment:{accountId:m.economics.accountId,
     currency:"USD",maximumMinor:action.cost,pricingReference:"quote:simulation:"+id}}:{}),
   };
   const request=yield* Effect.tryPromise({
     try:()=>sealActionProposal(raw),
     catch:()=>new Error("Unable to seal simulated proposal"),
   });
   const decision=yield* controller.evaluate(request,NOW);
   if(decision.kind==="deny"||decision.kind==="escalate"){
    attempts.push({action:request.action,risk:request.risk,decision,
     status:decision.kind==="deny"?"denied":"escalated"});continue;
   }
   const effect=controller.commit(request,NOW);
   const receipt=yield* effect;
   attempts.push({action:request.action,risk:request.risk,decision,status:"simulated",receipt});
  }
  const account=yield* ledger.account(m.economics.accountId);
  const obligations=assessObligations(m,[{metric:"availability",value:p.metrics.availability,
   sourceId:"simulated:"+p.kind,observedAt:NOW,windowSeconds:3600}],NOW);
  return {
   version:"awc.simulation/v1" as const,scenario:id,mode:"strictly-simulated" as const,
   managedEntityId:entityId,mandateId:m.id,before,after:env.snapshot(),
   account:{fundedMinor:account.fundedMinor,spentMinor:account.spentMinor,
    reservedMinor:account.reservedMinor,availableMinor:account.availableMinor},
   obligations,attemptedActions:attempts,events:env.events,
   nextReconciliation:recommendOperationalWork(env.entity,env.observe(NOW)),
   note:"Fictional telemetry, simulated authorization and simulated funds. NO real equipment, cloud resource, contractor or payments touched.",
  };
 });
}
