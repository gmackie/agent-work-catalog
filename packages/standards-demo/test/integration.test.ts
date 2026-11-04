import {describe,expect,it} from "vitest";
import { runStandardsScenario } from "../src/index.ts";
import { parseSupportedOdrl } from "@awc/odrl-profile";
describe("cross-standards synthetic responsibility contract",()=>{
 it("maps vending mandate, financial outcome, CloudEvents and PROV-O coherently",async()=>{
  const r=await runStandardsScenario("vending");
  expect(parseSupportedOdrl(r.odrl).id).toBe(r.simulation.mandate.id);
  expect(r.simulation.account.spentMinor).toBe("1800");
  expect(r.authzen[0]?.output.decision).toBe(true); // unconditionally permitted telemetry read
  expect(r.authzen[1]?.output.decision).toBe(false); // paid procurement requires real commit
  expect(r.cloudevents).toHaveLength(1);
  expect(r.provenance).toHaveLength(1);
  expect(r.provenance[0]?.["@graph"].some(n=>n["prov:actedOnBehalfOf"]!==undefined)).toBe(true);
  expect(r.openslo.map(x=>x.kind)).toEqual(["SLI","SLO"]);
  expect(r.ublExampleOrderXml).toContain("UBLVersionID>2.4");
  expect(r.oauthRichAuthorizationDetails).toHaveLength(1);
  expect(r.oauthRichAuthorizationDetails[0]?.awc_maximum_minor).toBe("1800");
  expect(r.fictionalIndependentReceipt?.epcisBody.eventList[0]?.bizStep).toBe("receiving");
  expect(r.osbProvisionPreview).toBeUndefined();
 });
 it("builds an OSB provision preview for cloud only and no active infrastructure",async()=>{
  const r=await runStandardsScenario("cloud");
  expect(r.osbProvisionPreview?.authorizedForExecution).toBe(false);
  expect(r.osbProvisionPreview?.url).toContain("/v2/service_instances/demo-instance-001");
  expect(r.oauthRichAuthorizationDetails[0]?.awc_maximum_minor).toBe("3500");
  expect(r.fictionalIndependentReceipt).toBeUndefined();
  expect(r.cloudevents.length).toBe(1);
 });
 it("keeps physical control denied and production scheduling escalated",async()=>{
  const r=await runStandardsScenario("plant");
  expect(r.simulation.attemptedActions.map(x=>x.status)).toEqual(["simulated","escalated","denied"]);
  expect(r.authzen.map(x=>x.output.decision)).toEqual([true,false,false,false]);
  expect(r.cloudevents).toHaveLength(1);
  expect(r.simulation.account.spentMinor).toBe("0");
  expect(r.osbProvisionPreview).toBeUndefined();
  expect(r.oauthRichAuthorizationDetails).toHaveLength(0);
  expect(r.fictionalIndependentReceipt).toBeUndefined();
 });
});
