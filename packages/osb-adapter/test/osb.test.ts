import {describe,expect,it} from "vitest";
import {parseOsbCatalog,osbResourcePlans,previewOsbProvision} from "../src/index.ts";
const catalog=parseOsbCatalog({services:[{
 id:"service-a",name:"gpu-compute",description:"GPU capacity",bindable:false,
 plans:[{id:"plan-gpu",name:"a100-hour",description:"Hourly GPU"}]
}]});
const grant={providerId:"registered:cloud",serviceId:"service-a",planId:"plan-gpu",
 instanceId:"resource-123",contractDigest:"a".repeat(64),accountId:"account:one",
 maxSpendMinor:"5000",currency:"USD",expiresAt:"2026-11-01T22:00:00Z"};
describe("Open Service Broker 2.17 discovery/provision preview",()=>{
 it("normalizes catalog without inventing prices",()=>{
  const p=osbResourcePlans(catalog,"registered:cloud");
  expect(p[0]?.requiresQuote).toBe(true);
  expect(p[0]?.planId).toBe("plan-gpu");
 });
 it("generates a standard PUT preview but never provisions",()=>{
  const p=previewOsbProvision({catalog,registeredProviderId:"registered:cloud",
   trustedBrokerOrigin:"https://broker.example",grant,now:"2026-11-01T18:00:00Z"});
  expect(p.method).toBe("PUT");expect(p.authorizedForExecution).toBe(false);
  expect(p.headers["X-Broker-API-Version"]).toBe("2.17");
  expect(p.url).toContain("/v2/service_instances/resource-123");
 });
 it("fails on untrusted broker origin, expired grant, unknown plan and forged provider",()=>{
  const base={catalog,registeredProviderId:"registered:cloud",
   trustedBrokerOrigin:"https://broker.example",grant,now:"2026-11-01T18:00:00Z"};
  expect(()=>previewOsbProvision({...base,trustedBrokerOrigin:"http://169.254.169.254"})).toThrow();
  expect(()=>previewOsbProvision({...base,grant:{...grant,planId:"other"}})).toThrow();
  expect(()=>previewOsbProvision({...base,grant:{...grant,providerId:"attacker"}})).toThrow();
  expect(()=>previewOsbProvision({...base,now:"2026-11-02T00:00:00Z"})).toThrow();
 });
});
