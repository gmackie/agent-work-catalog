import {describe,expect,it} from "vitest";
import {projectMetricObligation,projectMandateObjectives} from "../src/index.ts";
import type {OperatingMandate,Obligation} from "@awc/responsibility";
const mandate={operationId:"operation:vending",obligations:[]} as unknown as OperatingMandate;
const metric:Obligation={kind:"metric",id:"uptime",metric:"availability",comparator:">=",
 target:0.98,windowSeconds:2592000,observationSourceId:"source:machine"};
describe("OpenSLO v1 threshold metric projection",()=>{
 it("exports SLI and SLO with source and rolling window, without claiming evidence",()=>{
  const [sli,slo]=projectMetricObligation(mandate,metric,{reliabilityTarget:0.99});
  expect(sli.kind).toBe("SLI");
  expect(slo.kind).toBe("SLO");
  const s=slo.spec as {indicatorRef:string;objectives:{op:string;value:number}[];timeWindow:{duration:string}[]};
  expect(s.indicatorRef).toBe(sli.metadata.name);
  expect(s.objectives).toEqual([{displayName:"uptime",op:"gte",value:0.98,target:0.99}]);
  expect(s.timeWindow[0]?.duration).toBe("43200m");
 });
 it("omits unsupported process obligations and fails closed on equality/partial windows",()=>{
  const process={kind:"process",id:"response",action:"ticket.create",requiredWithinSeconds:300} as const;
  expect(projectMandateObjectives({...mandate,obligations:[metric,process]},{uptime:{reliabilityTarget:0.99}})).toHaveLength(2);
  expect(projectMandateObjectives({...mandate,obligations:[metric]} ,{})).toHaveLength(0);
  expect(()=>projectMetricObligation(mandate,metric,{reliabilityTarget:1})).toThrow();
  expect(()=>projectMetricObligation(mandate,process,{reliabilityTarget:0.99})).toThrow();
  expect(()=>projectMetricObligation(mandate,{...metric,comparator:"="},{reliabilityTarget:0.99})).toThrow();
  expect(()=>projectMetricObligation(mandate,{...metric,windowSeconds:17},{reliabilityTarget:0.99})).toThrow();
 });
});
