import type { OperatingMandate, Obligation } from "@awc/responsibility";
export class OpenSloError extends Error {
 constructor(readonly code:"unsupported_obligation"|"invalid_source",message:string) {
  super(message);this.name="OpenSloError";
 }
}
const safe=(s:string)=>s.toLowerCase().replace(/[^a-z0-9-]/g,"-").replace(/-+/g,"-").replace(/^-|-$/g,"").slice(0,100);
export interface OpenSloDocument {
 readonly apiVersion:"openslo/v1";
 readonly kind:"SLO"|"SLI";
 readonly metadata:{readonly name:string;readonly displayName?:string};
 readonly spec:Readonly<Record<string,unknown>>;
}
/**
 * Export only thresholdMetric SLOs with >= or <= and an explicit source adapter.
 * This is NOT a real telemetry query. The consumer must implement AWC metricSource.
 */
export function projectMetricObligation(
 mandate:OperatingMandate,
 obligation:Obligation,
):readonly [OpenSloDocument,OpenSloDocument] {
 if(obligation.kind!=="metric"||obligation.comparator==="=" ||
   !Number.isFinite(obligation.target)||
   !Number.isSafeInteger(obligation.windowSeconds)||obligation.windowSeconds<=0||
   obligation.windowSeconds%60!==0){
  throw new OpenSloError("unsupported_obligation","Obligation is not representable by this OpenSLO v1 subset");
 }
 if(!obligation.observationSourceId||!obligation.metric){
  throw new OpenSloError("invalid_source","Missing authoritative measurement source");
 }
 const name=safe(mandate.operationId+"-"+obligation.id);
 const sliName=name+"-sli";
 const indicator:OpenSloDocument={
  apiVersion:"openslo/v1",kind:"SLI",
  metadata:{name:sliName,displayName:obligation.metric},
  spec:{thresholdMetric:{metricSource:{
    type:"AWC",spec:{sourceId:obligation.observationSourceId,metric:obligation.metric},
  }}},
 };
 const objective:OpenSloDocument={
  apiVersion:"openslo/v1",kind:"SLO",metadata:{name,displayName:obligation.id},
  spec:{
    service:safe(mandate.operationId),
    indicatorRef:sliName,
    timeWindow:[{duration:obligation.windowSeconds/60+"m",isRolling:true}],
    budgetingMethod:"Occurrences",
    objectives:[{displayName:obligation.id,
      op:obligation.comparator===">="?"gte":"lte",
      value:obligation.target}],
  },
 };
 return [indicator,objective];
}
export function projectMandateObjectives(mandate:OperatingMandate):readonly OpenSloDocument[]{
 return mandate.obligations.flatMap(o=>o.kind==="metric"&&o.comparator!=="="?
  [...projectMetricObligation(mandate,o)]:[]);
}
