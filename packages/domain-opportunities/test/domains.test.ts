import {describe,expect,it} from "vitest";
import {domainOpportunities} from "../src/index.ts";
describe("research-only agent offering verticals",()=>{
 it("contains twelve explicitly non-commercial domains with outcome and verification contracts",()=>{
   expect(domainOpportunities).toHaveLength(12);
   expect(new Set(domainOpportunities.map(x=>x.id)).size).toBe(12);
   expect(domainOpportunities.every(x=>x.readiness==="design-only"&&x.deliverables.length>=2&&
     x.acceptanceTests.length>=2&&x.inputs.length>=2&&x.firstDemo.length>10)).toBe(true);
 });
});
