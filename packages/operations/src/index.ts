import { Context, Effect, Layer } from "effect";
import { evaluateAction, type ActionProposal, type OperatingMandate, type PolicyContext,
  type OwnerPermission, type PolicyDecision, type TrustedObservation } from "@awc/responsibility";
import { type EconomicLedger, EconomicError } from "@awc/economics";

export interface ManagedEntity {
 readonly id:string;
 readonly kind:"vending-machine"|"cloud-service"|"production-cell";
 readonly ownerId:string;
 readonly operationalPrincipalId:string;
 readonly actions:readonly string[];
}
export interface OperationalObservation extends TrustedObservation {
 readonly metrics:Readonly<Record<string,number>>;
 readonly dataClassification:"internal";
}
export interface OperationEvent {
 readonly id:string;readonly operationId:string;readonly entityId:string;
 readonly proposalId:string;readonly action:string;readonly type:"planned"|"committed";
 readonly at:string;readonly outcome:"simulated"|"rejected";
 readonly detail:string;
}
export interface ActionReceipt {
 readonly schemaVersion:"awc.action-receipt/v1";
 readonly proposalId:string;readonly revision:string;
 readonly operationId:string;readonly entityId:string;
 readonly simulation:true;
 readonly acceptedAt:string;
 readonly beforeVersion:string;readonly afterVersion:string;
 readonly eventId:string;
 readonly reservationId?:string;
 readonly chargedMinor?:string;
 readonly evidenceIssuer:"awc:simulator";
}
export class OperationsError extends Error {
 readonly _tag="OperationsError";
 constructor(readonly code:"state_conflict"|"denied"|"approval_required"|"unsupported"|"invalid_proposal"|"unavailable",
  message:string){super(message);this.name="OperationsError";}
}
/** This port is a standalone simulation. It has no access to PLCs, payments or real cloud accounts. */
export interface OperationEnvironment {
 readonly entity:ManagedEntity;
 observe(now:string):OperationalObservation;
 /** Compare observed version and apply an allowlisted simulated state transition synchronously. */
 apply(proposal:ActionProposal,now:string):OperationEvent;
 readonly events:readonly OperationEvent[];
}
export interface OperationsCoordinator {
 readonly inspect:(now:string)=>Effect.Effect<OperationalObservation>;
 readonly evaluate:(proposal:ActionProposal,now:string)=>Effect.Effect<PolicyDecision>;
 readonly commit:(proposal:ActionProposal,now:string)=>Effect.Effect<ActionReceipt,OperationsError>;
 readonly history:()=>Effect.Effect<readonly OperationEvent[]>;
}
export class OperationsService extends Context.Service<OperationsService,OperationsCoordinator>()("@awc/OperationsService") {}
/**
 * Trust topology: mandate and owner grants are constructor-supplied by trusted system adapters,
 * never inferred from model input. Approval evidence is provided by the trusted approval service.
 */
export function makeSimulatedOperations(
 environment:OperationEnvironment,
 mandate:OperatingMandate,
 graph:readonly OperatingMandate[],
 ownerPermissions:readonly OwnerPermission[],
 ledger:EconomicLedger,
 options:{readonly revokedMandateIds?:readonly string[];readonly approvedProposals?:readonly {
   approverId:string;proposalId:string;revision:string;validUntil:string;
 }[]}={},
):OperationsCoordinator{
 const receipts=new Map<string,ActionReceipt>();
 const ctx=(now:string):PolicyContext=>({
  now,mandates:graph,ownerPermissions,revokedMandateIds:options.revokedMandateIds??[],
  observation:environment.observe(now),approvals:options.approvedProposals??[],
 });
 const guarded=<T>(fn:()=>T):Effect.Effect<T,OperationsError>=>Effect.try({
  try:fn,catch:e=>e instanceof OperationsError?e:new OperationsError("unavailable","Operation service failed"),
 });
 const evaluate=(proposal:ActionProposal,now:string)=>
  Effect.sync(()=>evaluateAction(proposal,ctx(now)));
 return {
  inspect:now=>Effect.sync(()=>environment.observe(now)),
  evaluate,
  history:()=>Effect.sync(()=>environment.events),
  commit:(proposal,now)=>Effect.gen(function*(){
   const key=proposal.id;
   const prior=receipts.get(key);
   if(prior){
    if(prior.revision!==proposal.revision||prior.entityId!==proposal.entityId){
     return yield* Effect.fail(new OperationsError("state_conflict","Proposal ID reused with different terms"));
    }
    return prior;
   }
   if(proposal.mandateId!==mandate.id||proposal.operationId!==mandate.operationId ||
      proposal.entityId!==environment.entity.id){
    return yield* Effect.fail(new OperationsError("invalid_proposal","Proposal does not belong to this managed operation"));
   }
   const decision=yield* evaluate(proposal,now);
   if(decision.kind==="deny")return yield* Effect.fail(
    new OperationsError("denied","Policy denied: "+decision.reasonCodes.join(",")));
   if(decision.kind==="escalate")return yield* Effect.fail(
    new OperationsError("approval_required","Independent approval is required"));
   if(!environment.entity.actions.includes(proposal.action)){
    return yield* Effect.fail(new OperationsError("unsupported","Adapter does not support this action"));
   }
   let reservation: {id:string}|undefined;
   if(proposal.commitment){
    const c=proposal.commitment;
    reservation=yield* ledger.reserveExpense({mandateId:mandate.id,actionId:proposal.id,
      idempotencyKey:proposal.id+":"+proposal.revision,maximumMinor:c.maximumMinor})
       .pipe(Effect.mapError((e:EconomicError)=>new OperationsError(
        "denied","Spending unavailable: "+e.code)));
   }
   let event:OperationEvent;
   try{
    // Re-read the trusted observation at action commit; no write may follow a stale version.
    const second=evaluateAction(proposal,ctx(now));
    if(second.kind==="deny"||second.kind==="escalate"){
      throw new OperationsError("denied","Authority changed before commit");
    }
    event=environment.apply(proposal,now);
   }catch(e){
    if(reservation){
      yield* ledger.releaseExpense(reservation.id).pipe(Effect.mapError(()=>new OperationsError("unavailable","Expense refund reconciliation required")));
    }
    return yield* Effect.fail(e instanceof OperationsError?e:new OperationsError("state_conflict","State version changed before action"));
   }
   let chargedMinor:string|undefined;
   if(reservation&&proposal.commitment){
    // ONLY simulated capture. Production settlement and irreversible operations need an
    // outbox, payment reconciler and an independent provider acknowledgment.
    const captured=yield* ledger.captureExpense(reservation.id,proposal.commitment.maximumMinor)
      .pipe(Effect.mapError(()=>new OperationsError("unavailable","Post-action account reconciliation required")));
    chargedMinor=captured.chargedMinor;
   }
   const receipt:ActionReceipt={
    schemaVersion:"awc.action-receipt/v1",proposalId:proposal.id,revision:proposal.revision,
    operationId:proposal.operationId,entityId:proposal.entityId,simulation:true,
    acceptedAt:now,beforeVersion:proposal.expectedStateVersion??"",
    afterVersion:environment.observe(now).stateVersion,eventId:event.id,
    ...(reservation?{reservationId:reservation.id}:{}),
    ...(chargedMinor!==undefined?{chargedMinor}:{}),
    evidenceIssuer:"awc:simulator",
   };
   receipts.set(key,receipt);
   return receipt;
  }),
 };
}
export const simulatedOperationsLayer=(service:OperationsCoordinator)=>
  Layer.succeed(OperationsService,service);

export interface MetricSample {
 readonly metric:string;readonly value:number;readonly sourceId:string;
 readonly observedAt:string;readonly windowSeconds:number;
}
export interface ObligationAssessment {
 readonly obligationId:string;readonly status:"met"|"breached"|"unknown";
 readonly observedValue?:number;
 readonly evidenceSource?:string;
}
/** Unknown stays unknown; never silently convert absent/stale data into SLO compliance. */
export function assessObligations(mandate:OperatingMandate,samples:readonly MetricSample[],now:string):readonly ObligationAssessment[]{
 const timestamp=Date.parse(now);
 return mandate.obligations.map(obligation=>{
  if(obligation.kind!=="metric")return {obligationId:obligation.id,status:"unknown" as const};
  const matched=samples.filter(s=>s.metric===obligation.metric &&
   s.sourceId===obligation.observationSourceId &&
   s.windowSeconds===obligation.windowSeconds &&
   Number.isFinite(s.value) && Number.isFinite(Date.parse(s.observedAt)) &&
   Date.parse(s.observedAt)<=timestamp &&
   timestamp-Date.parse(s.observedAt)<=mandate.scope.maximumObservationAgeMs);
  const latest=matched.sort((a,b)=>Date.parse(b.observedAt)-Date.parse(a.observedAt))[0];
  if(!latest)return {obligationId:obligation.id,status:"unknown" as const};
  const ok=obligation.comparator===">="?latest.value>=obligation.target:
   obligation.comparator==="<="?latest.value<=obligation.target:
   latest.value===obligation.target;
  return {obligationId:obligation.id,status:ok?"met" as const:"breached" as const,
   observedValue:latest.value,evidenceSource:latest.sourceId};
 });
}
