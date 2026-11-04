import type { ManagedEntity, OperationalObservation } from "./index.ts";

export interface PlannedOperationalWork {
 readonly action:string;
 readonly risk:"commercial"|"operational";
 readonly maximumMinor?:string;
 readonly reason:string;
}
/**
 * Deterministic read-only reconciler. Proposes business actions but never executes them.
 * A pending request suppresses repeated procurement until a separate confirmation/failure
 * changes authoritative state. This is not an AI model or equipment controller.
 */
export function recommendOperationalWork(
 entity:ManagedEntity,
 observation:OperationalObservation,
):readonly PlannedOperationalWork[]{
 if(observation.entityId!==entity.id || !Number.isFinite(Date.parse(observation.observedAt))) return [];
 const m=observation.metrics;
 const proposals:PlannedOperationalWork[]=[];
 if(entity.kind==="vending-machine"){
  if((m.stockRemaining??Infinity)<5 && (m.restockOrders??0)===0)
   proposals.push({action:"inventory.replenishment.request",risk:"commercial",
    maximumMinor:"1800",reason:"Low inventory with no pending replenishment"});
 }else if(entity.kind==="cloud-service"){
  if((m.requestRate??0)>1000 && (m.reservedComputeUnits??0)===0)
   proposals.push({action:"capacity.acquire",risk:"commercial",maximumMinor:"3500",
    reason:"Load exceeds threshold without an existing capacity reservation"});
 }else if(entity.kind==="production-cell"){
  if((m.throughput??Infinity)<900 && (m.maintenanceTickets??0)===0)
   proposals.push({action:"maintenance.ticket.create",risk:"operational",
    reason:"Reduced throughput requires maintenance investigation"});
  if((m.throughput??Infinity)<900 && (m.scheduleProposals??0)===0)
   proposals.push({action:"production.schedule.propose",risk:"operational",
    reason:"Operator must review any schedule change"});
 }
 return proposals.filter(x=>entity.actions.includes(x.action));
}
