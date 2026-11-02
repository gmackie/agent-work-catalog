import {describe,expect,it} from "vitest";
import {projectMetricObligation,projectMandateObjectives} from "../src/index.ts";
import type {OperatingMandate,Obligation} from "@awc/responsibility";
const mandate={operationId:"operation:vending",obligations:[]} as OperatingMandate;
const metric:Obligation={kind:"metric",id:"uptime",metric:"availability",comparator:">=",
 target:0.98,windowSeconds:2592000,observationSourceId:"source:machine"};
describe("OpenSLO v1 threshold metric projection",()=>{
 it("exports SLI and SLO with source and rolling window, without claiming evidence",()=>{
  const [sli,slo]=projectMetricObligation(mandate,metric);
  expect(sli.kind).toBe("SLI");
  expect(slo.kind).toBe("SLO");
  const s=slo.spec as {indicatorRef:string;objectives:{op:string;value:number}[];timeWindow:{duration:string}[]};
  expect(s.indicatorRef).toBe(sli.metadata.name);
  expect(s.objectives).toEqual([{displayName:"uptime",op:"gte",value:0.98}]);
  expect(s.timeWindow[0]?.duration).toBe("43200m");
 });
 it("omits unsupported process obligations and fails closed on equality/partial windows",()=>{
  const process={kind:"process",id:"response",action:"ticket.create",requiredWithinSeconds:300} as const;
  expect(projectMandateObjectives({...mandate,obligations:[metric,process]})).toHaveLength(2);
  expect(()=>projectMetricObligation(mandate,process)).toThrow();
  expect(()=>projectMetricObligation(mandate,{...metric,comparator:"="})).toThrow();
  expect(()=>projectMetricObligation(mandate,{...metric,windowSeconds:17})).toThrow();
 });
});
