import {describe,expect,it} from "vitest";
import {AWC_ODRL_PROFILE,projectMandateToOdrl,parseSupportedOdrl} from "../src/index.ts";
import type {OperatingMandate} from "@awc/responsibility";
const mandate:OperatingMandate={
  schemaVersion:"awc.operating-mandate/v1",id:"mandate:42",principalId:"org:vendor",
  delegateId:"agent:operator",accountablePartyId:"org:vendor",
  operationId:"operation:42",issuerId:"org:vendor",issuedAt:"2026-10-01T00:00:00Z",
  validFrom:"2026-10-01T00:00:00Z",expiresAt:"2026-12-01T00:00:00Z",
  scope:{entityIds:["machine:42"],actions:["inventory.replenishment.request","telemetry.read"],
    maximumRisk:"commercial",maximumDataClassification:"internal",
    deniedActions:["machine.safety_override"],approvalActions:[],
    maximumObservationAgeMs:60000,remainingDelegations:1},
  economics:{accountId:"account:o",currency:"USD",maxTotalMinor:"50000",
    maxPerActionMinor:"5000"},
  obligations:[{kind:"metric",id:"obj:availability",metric:"availability",
    comparator:">=",target:0.98,windowSeconds:2592000,observationSourceId:"machine:telemetry"},
    {kind:"process",id:"obj:response",action:"maintenance.ticket.create",requiredWithinSeconds:300}],
};
describe("Restricted ODRL 2.2 AWC profile",()=>{
 it("exports permissions, prohibitions, obligations and exact principal identity",()=>{
  const doc=projectMandateToOdrl(mandate);
  expect(doc["@type"]).toBe("Agreement");
  expect(doc.profile).toBe(AWC_ODRL_PROFILE);
  expect(doc.permission).toHaveLength(2);
  expect(doc.prohibition[0]?.action).toContain("machine.safety_override");
  expect(doc.obligation).toHaveLength(2);
  expect(parseSupportedOdrl(JSON.parse(JSON.stringify(doc)))).toEqual(mandate);
 });
 it("rejects altered permissions, unsupported constraints, unknown fields and mutated amounts",()=>{
  const base=projectMandateToOdrl(mandate);
  expect(()=>parseSupportedOdrl({...base,permission:[]})).toThrow();
  expect(()=>parseSupportedOdrl({...base,extra:"allow-all"})).toThrow();
  expect(()=>parseSupportedOdrl({...base,permission:[{...base.permission[0]!,action:"odrl:use"}]})).toThrow();
  expect(()=>parseSupportedOdrl({...base,"awc:sourceMandate":{
    "@type":"@json", "@value":{...mandate,economics:{...mandate.economics,maxPerActionMinor:"999999"}}
  }})).toThrow();
  expect(()=>parseSupportedOdrl({...base,permission:[{
    ...base.permission[0]!,constraint:[{leftOperand:"dateTime",operator:"lt",rightOperand:"2099-01-01T00:00:00Z"}]
  }]})).toThrow();
 });
});
