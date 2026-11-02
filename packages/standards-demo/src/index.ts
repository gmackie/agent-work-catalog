import { Effect } from "effect";
import { runScenario, type ScenarioId, type SimulationReport } from "@awc/simulations";
import { actionToAuthzen, createAuthzenPdp, type AuthzenEvaluationRequest, type AuthzenDecision } from "@awc/authzen";
import { projectMandateToOdrl, type OdrlAgreement } from "@awc/odrl-profile";
import { actionReceiptEvent, makeMemoryEventJournal, type AWCCloudEvent } from "@awc/events";
import { actionProvenance, type ProvGraph } from "@awc/provenance";
import { projectMandateObjectives, type OpenSloDocument } from "@awc/openslo";
import { osbResourcePlans,parseOsbCatalog,previewOsbProvision, type ProvisionPreview } from "@awc/osb-adapter";
import { exportUblOrder } from "@awc/ubl-adapter";
import { sealActionProposal, type ActionProposal } from "@awc/responsibility";

export interface AuthzenSample {
  readonly input: AuthzenEvaluationRequest;
  readonly output: AuthzenDecision;
}
export interface StandardsReport {
 readonly mode:"strictly-simulated";
 readonly scenario:ScenarioId;
 readonly simulation:SimulationReport;
 readonly odrl:OdrlAgreement;
 readonly authzen:readonly AuthzenSample[];
 readonly cloudevents:readonly AWCCloudEvent[];
 readonly provenance:readonly ProvGraph[];
 readonly openslo:readonly OpenSloDocument[];
 readonly osbProvisionPreview?:ProvisionPreview;
 readonly ublExampleOrderXml?:string;
 readonly note:string;
}
/**
 * One synthetic scenario projected across independent standards.
 * No endpoint discovery, unsigned attestations, wallet access, cloud provisioning
 * or physical equipment control occurs here.
 */
export async function runStandardsScenario(id:ScenarioId):Promise<StandardsReport>{
 const simulation=await Effect.runPromise(runScenario(id));
 const {mandate,trustedPolicyContext,attemptedActions}=simulation;
 const odrl=projectMandateToOdrl(mandate);
 const raw:ActionProposal={
  schemaVersion:"awc.action/v1",id:"proposal:demo:"+id+":read",revision:"0".repeat(64),
  mandateId:mandate.id,operationId:mandate.operationId,actorId:mandate.delegateId,
  entityId:simulation.managedEntityId,action:"telemetry.read",risk:"observe",
  dataClassification:"internal",requestedAt:trustedPolicyContext.now,effects:[],
 };
 const readProposal=await sealActionProposal(raw);
 const requests=[readProposal,...attemptedActions.map(a=>a.proposal)];
 const pdp=createAuthzenPdp({
  resolve:async(ref)=> {
   const proposal=requests.find(p=>p.id===ref);
   return proposal?{proposal,policy:trustedPolicyContext}:undefined;
  }
 });
 const authzen=await Promise.all(requests.map(async(proposal)=>({
  input:actionToAuthzen(proposal),
  output:await pdp.evaluate(actionToAuthzen(proposal),{
   subjectId:mandate.delegateId,clientId:"awc:synthetic-agent-client",
  }),
 })));
 const journal=makeMemoryEventJournal();
 const provenance:ProvGraph[]=[];
 for(const a of attemptedActions){
  if(!a.receipt)continue;
  const event=actionReceiptEvent(a.proposal,a.receipt,journal.list(
    "urn:awc:operation:"+encodeURIComponent(a.proposal.operationId),a.proposal.entityId).length+1);
  journal.append(event);
  provenance.push(actionProvenance(mandate,a.proposal,a.receipt));
 }
 const cloudevents=journal.list("urn:awc:operation:"+encodeURIComponent(mandate.operationId),
  simulation.managedEntityId);
 const openslo=projectMandateObjectives(mandate);
 let osbProvisionPreview:ProvisionPreview|undefined;
 if(id==="cloud"){
  const catalog=parseOsbCatalog({services:[{
   id:"sample-compute",name:"demo-cpu",description:"Fictional compute resource",
   bindable:false,plans:[{id:"sample-medium",name:"medium",description:"Fictional compute plan"}]
  }]});
  if(osbResourcePlans(catalog,"broker:demo").length!==1)throw Error("Invalid demo resource catalog");
  osbProvisionPreview=previewOsbProvision({
   registeredProviderId:"broker:demo",trustedBrokerOrigin:"https://osb-demo.invalid",
   catalog,now:trustedPolicyContext.now,
   grant:{providerId:"broker:demo",serviceId:"sample-compute",planId:"sample-medium",
    instanceId:"demo-instance-001",contractDigest:"a".repeat(64),accountId:mandate.economics.accountId,
    maxSpendMinor:"3500",currency:"USD",expiresAt:"2026-11-01T19:00:00Z"}
  });
 }
 let ublExampleOrderXml:string|undefined;
 if(id==="vending"){
  ublExampleOrderXml=exportUblOrder({id:"demo-order-001",
   issueDate:"2026-11-01",buyerName:"Fictional Vending Operator",
   sellerName:"Fictional Wholesale Supplier",currency:"USD",
   contractDigest:attemptedActions[0]?.proposal.revision??"0".repeat(64),
   lines:[{id:"1",itemName:"Bottled Water",quantity:12,unitCode:"EA",priceMinor:"150"}]});
 }
 return {
  mode:"strictly-simulated",scenario:id,simulation,odrl,authzen,cloudevents,
  provenance,openslo,
  ...(osbProvisionPreview?{osbProvisionPreview}:{}),
  ...(ublExampleOrderXml?{ublExampleOrderXml}:{}),
  note:"Cross-protocol synthetic projections. AuthZEN only unconditionally permits reads; conditional operations still require authoritative commit and finance checks. No signed VC or production control.",
 };
}
