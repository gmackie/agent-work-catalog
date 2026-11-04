import { assertMandateValid, decodeMandate } from "@awc/responsibility";
import type { OperatingMandate, Obligation } from "@awc/responsibility";

/**
 * Restricted ODRL 2.2 JSON-LD profile for AWC.
 * Profile serialization != enforcement, digital signature, or legal agreement.
 * Import is deliberately restricted to exact documents produced by this adapter.
 */
export const ODRL_CONTEXT = "http://www.w3.org/ns/odrl.jsonld";
export const AWC_ODRL_PROFILE = "https://github.com/gmackie/agent-work-catalog#odrl-operating-mandate-v1";
export const AWC_ODRL_VOCAB = "https://github.com/gmackie/agent-work-catalog#";
export interface OdrlConstraint {
  readonly leftOperand:string;
  readonly operator:"eq"|"gteq"|"lt"|"lteq";
  readonly rightOperand:string;
}
export interface OdrlRule {
  readonly assigner:string;
  readonly assignee:string;
  readonly target:string;
  readonly action:string;
  readonly constraint?:readonly OdrlConstraint[];
}
export interface OdrlDuty {
  readonly action:string;
  readonly target:string;
  readonly constraint:readonly OdrlConstraint[];
}
export interface OdrlAgreement {
  readonly "@context":readonly [string,{readonly awc:string}];
  readonly "@type":"Agreement";
  readonly uid:string;
  readonly profile:typeof AWC_ODRL_PROFILE;
  readonly permission:readonly OdrlRule[];
  readonly prohibition:readonly OdrlRule[];
  readonly obligation:readonly OdrlDuty[];
  readonly "awc:sourceMandate":{
    readonly "@type":"@json";
    readonly "@value":OperatingMandate;
  };
}
export class OdrlProfileError extends Error {
  readonly _tag="OdrlProfileError";
  constructor(readonly code:"invalid_profile"|"unsupported_constraint",message:string){
    super(message);this.name="OdrlProfileError";
  }
}
const uri=(kind:string,id:string) => "urn:awc:"+kind+":"+encodeURIComponent(id);
const measure=(leftOperand:string,operator:OdrlConstraint["operator"],rightOperand:string):
  OdrlConstraint=>({leftOperand,operator,rightOperand});
function duty(o:Obligation,mandate:OperatingMandate):OdrlDuty {
  const target=uri("operation",mandate.operationId);
  if(o.kind==="metric"){
    return {action:"awc:maintainMetric",target,constraint:[
      measure("awc:obligationId","eq",o.id),measure("awc:metric","eq",o.metric),
      measure("awc:threshold",o.comparator===">="?"gteq":o.comparator==="<="?"lteq":"eq",String(o.target)),
      measure("awc:windowSeconds","eq",String(o.windowSeconds)),
      measure("awc:observationSource","eq",o.observationSourceId)
    ]};
  }
  if(o.kind==="process"){
    return {action:"awc:performProcess",target,constraint:[
      measure("awc:obligationId","eq",o.id),measure("awc:action","eq",o.action),
      measure("awc:deadlineSeconds","lteq",String(o.requiredWithinSeconds))
    ]};
  }
  return {action:"awc:avoidAction",target,constraint:[
    measure("awc:obligationId","eq",o.id),measure("awc:action","eq",o.action)
  ]};
}
export function projectMandateToOdrl(m:OperatingMandate):OdrlAgreement {
  assertMandateValid(m);
  const parties={assigner:uri("party",m.principalId),assignee:uri("agent",m.delegateId)};
  const valid:readonly OdrlConstraint[]=[
    measure("dateTime","gteq",m.validFrom),
    measure("dateTime","lt",m.expiresAt),
  ];
  const permission=m.scope.entityIds.flatMap(entityId=>m.scope.actions.map(action=>({
    ...parties,target:uri("entity",entityId),action:uri("action",action),constraint:valid,
  })));
  const prohibition=m.scope.entityIds.flatMap(entityId=>m.scope.deniedActions.map(action=>({
    ...parties,target:uri("entity",entityId),action:uri("action",action),
  })));
  return {
    "@context":[ODRL_CONTEXT,{awc:AWC_ODRL_VOCAB}],
    "@type":"Agreement",uid:uri("mandate",m.id),profile:AWC_ODRL_PROFILE,
    permission,prohibition,obligation:m.obligations.map(o=>duty(o,m)),
    "awc:sourceMandate":{"@type":"@json","@value":m},
  };
}
/** Stable structural comparator: object property ordering does not define permission changes. */
function canonical(x:unknown):string {
  if(Array.isArray(x))return "["+x.map(canonical).join(",")+"]";
  if(x && typeof x==="object"){
    const entries=Object.entries(x).sort(([a],[b])=>a.localeCompare(b));
    return "{"+entries.map(([k,v])=>JSON.stringify(k)+":"+canonical(v)).join(",")+"}";
  }
  return JSON.stringify(x);
}
/**
 * Fail-closed import: unsupported operators, duties, unknown properties and mutated
 * permissions will not become new trusted mandates. Import is only a document
 * round-trip, never a signature or delegated-power verification.
 */
export function parseSupportedOdrl(raw:unknown):OperatingMandate {
  if(!raw||typeof raw!=="object"||Array.isArray(raw)) {
    throw new OdrlProfileError("invalid_profile","Not an ODRL agreement object");
  }
  const record=raw as Record<string,unknown>;
  const source=record["awc:sourceMandate"];
  if(!source||typeof source!=="object"||Array.isArray(source)||
    (source as Record<string,unknown>)["@type"]!=="@json"){
    throw new OdrlProfileError("invalid_profile","Missing AWC typed source mandate");
  }
  try {
    const m=decodeMandate((source as Record<string,unknown>)["@value"]);
    const expected=projectMandateToOdrl(m);
    if(canonical(raw)!==canonical(expected)){
      throw new OdrlProfileError("unsupported_constraint","Policy differs from the supported AWC ODRL profile");
    }
    return m;
  }catch(e){
    if(e instanceof OdrlProfileError)throw e;
    throw new OdrlProfileError("invalid_profile","Invalid or unsupported AWC ODRL document");
  }
}
