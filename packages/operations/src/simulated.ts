import type { ActionProposal } from "@awc/responsibility";
import { OperationsError, type ManagedEntity, type OperationalObservation, type OperationEnvironment,
  type OperationEvent } from "./index.ts";

/** Application-layer state simulation, NOT an equipment-control interface. */
export function createSimulatedEnvironment(
 entity:ManagedEntity,
 initial:Readonly<Record<string,number>>,
 observedAt:string,
):OperationEnvironment & {readonly snapshot:()=>Readonly<Record<string,number>>}{
 const metrics:Record<string,number>={...initial};
 let state=0;
 let lastObserved=observedAt;
 const events:OperationEvent[]=[];
 const processed=new Map<string,{revision:string;event:OperationEvent}>();
 const allowed:Record<ManagedEntity["kind"],readonly string[]>={
  "vending-machine":["inventory.replenishment.request","maintenance.ticket.create","telemetry.read"],
  "cloud-service":["capacity.acquire","capacity.release","incident.ticket.create","telemetry.read"],
  "production-cell":["maintenance.ticket.create","production.schedule.propose","telemetry.read"],
 };
 return {
  entity,events,
  snapshot:()=>({...metrics}),
  observe:()=>({entityId:entity.id,stateVersion:"state:"+state,observedAt:lastObserved,
   sourceId:"simulated:"+entity.kind,metrics:{...metrics},dataClassification:"internal"}),
  apply:(proposal:ActionProposal,now:string)=>{
   if(proposal.entityId!==entity.id||!allowed[entity.kind].includes(proposal.action) ||
      !entity.actions.includes(proposal.action) ||
      proposal.risk==="physical-control"||proposal.risk==="safety-critical"){
    throw new OperationsError("unsupported","No supported physical control action");
   }
   const past=processed.get(proposal.id);
   if(past){
    if(past.revision!==proposal.revision)throw new OperationsError("state_conflict","Proposal revised after execution");
    return past.event;
   }
   if(proposal.expectedStateVersion!=="state:"+state){
    throw new OperationsError("state_conflict","Observed version no longer current");
   }
   // These are simulated business-state changes; none actuate machinery or call cloud APIs.
   switch(proposal.action){
    case "inventory.replenishment.request": metrics.restockOrders=(metrics.restockOrders??0)+1; break;
    case "maintenance.ticket.create": metrics.maintenanceTickets=(metrics.maintenanceTickets??0)+1; break;
    case "capacity.acquire": metrics.reservedComputeUnits=(metrics.reservedComputeUnits??0)+1; break;
    case "capacity.release": metrics.reservedComputeUnits=Math.max(0,(metrics.reservedComputeUnits??0)-1); break;
    case "incident.ticket.create": metrics.incidentTickets=(metrics.incidentTickets??0)+1; break;
    case "production.schedule.propose": metrics.scheduleProposals=(metrics.scheduleProposals??0)+1; break;
    case "telemetry.read": break;
   }
   state++;lastObserved=now;
   const event:OperationEvent={
    id:"event:"+crypto.randomUUID(),operationId:proposal.operationId,
    entityId:entity.id,proposalId:proposal.id,action:proposal.action,
    type:"committed",at:now,outcome:"simulated",
    detail:"DEMO ONLY: authorized, synthetic operation; no real asset or payment changed",
   };
   events.push(event);processed.set(proposal.id,{revision:proposal.revision,event});
   return event;
  },
 };
}
