import type { ActionProposal, OperatingMandate } from "@awc/responsibility";
import type { ActionReceipt } from "@awc/operations";
export interface ProvNode {readonly "@id":string;readonly "@type":string;readonly [key:string]:unknown;}
export interface ProvGraph {
  readonly "@context":Readonly<Record<string,string>>;
  readonly "@graph":readonly ProvNode[];
}
/**
 * PROV-O JSON-LD structure: attribution, acting-on-behalf-of, used/generated.
 * Export does NOT sign, attest accuracy, or publish underlying private data.
 */
const id=(kind:string,key:string)=>"urn:awc:"+kind+":"+encodeURIComponent(key);
const ref=(key:string)=>({"@id":key});
export function actionProvenance(
 mandate:OperatingMandate,
 proposal:ActionProposal,
 receipt:ActionReceipt,
):ProvGraph {
  if(mandate.id!==proposal.mandateId||mandate.operationId!==proposal.operationId||
    mandate.delegateId!==proposal.actorId||receipt.proposalId!==proposal.id||
    receipt.revision!==proposal.revision||receipt.entityId!==proposal.entityId||
    receipt.operationId!==proposal.operationId){
    throw new Error("PROV-O action graph references inconsistent source commitments");
  }
  const principal=id("party",mandate.principalId);
  const agent=id("agent",proposal.actorId);
  const mandateRef=id("mandate",mandate.id);
  const action=id("activity",receipt.eventId);
  const input=id("proposal",proposal.id+":"+proposal.revision);
  const result=id("receipt",receipt.eventId);
  return {
    "@context":{
      prov:"http://www.w3.org/ns/prov#",
      xsd:"http://www.w3.org/2001/XMLSchema#",
      awc:"https://github.com/gmackie/agent-work-catalog#",
    },
    "@graph":[
      {"@id":principal,"@type":"prov:Agent"},
      {"@id":agent,"@type":"prov:Agent","prov:actedOnBehalfOf":ref(principal)},
      {"@id":mandateRef,"@type":"prov:Entity","prov:wasAttributedTo":ref(principal)},
      {"@id":input,"@type":"prov:Entity","awc:proposalRevision":proposal.revision},
      {"@id":action,"@type":"prov:Activity",
       "prov:wasAssociatedWith":ref(agent),"prov:used":[ref(input),ref(mandateRef)],
       "prov:startedAtTime":{"@value":proposal.requestedAt,"@type":"xsd:dateTime"},
       "prov:endedAtTime":{"@value":receipt.acceptedAt,"@type":"xsd:dateTime"},
       "awc:simulation":receipt.simulation},
      {"@id":result,"@type":"prov:Entity","prov:wasGeneratedBy":ref(action),
       "prov:wasAttributedTo":ref(agent),"awc:simulation":receipt.simulation}
    ],
  };
}
