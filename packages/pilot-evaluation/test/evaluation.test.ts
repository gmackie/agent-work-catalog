import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { analyzeTcpPcap, type TcpReport } from "@awc/tcp-pcap";
import {
  evaluateCase, scorePilotCase, summarizePilotProgram, PilotError,
  type PilotCase,
} from "../src/index.ts";

function makePcap(): Uint8Array {
  const raw = new Uint8Array(24 + 16 + 54);
  const v = new DataView(raw.buffer);
  v.setUint32(0, 0xa1b2c3d4, true);
  v.setUint16(4, 2, true); v.setUint16(6, 4, true);
  v.setUint32(16, 65535, true); v.setUint32(20, 1, true);
  v.setUint32(24, 1700000000, true);
  v.setUint32(32, 54, true); v.setUint32(36, 54, true);
  v.setUint16(52, 0x0800, false); raw[54] = 0x45;
  v.setUint16(56, 40, false); raw[62] = 64; raw[63] = 6;
  raw.set([192, 0, 2, 10], 66); raw.set([192, 0, 2, 20], 70);
  v.setUint16(74, 40000, false); v.setUint16(76, 443, false);
  v.setUint32(78, 100, false); raw[86] = 0x50;
  raw[87] = 0x02; v.setUint16(88, 8192, false);
  return raw;
}
async function fixture(): Promise<{sample:PilotCase;report:TcpReport;bytes:Uint8Array}> {
  const bytes=makePcap();
  const report=await analyzeTcpPcap(bytes);
  const sample:PilotCase={
    schemaVersion:"awc.tcp.pilot-case/v1",caseId:"syn_capture_01",
    offeringId:"offering:tcp-pcap-evidence",offeringVersion:"1",
    capture:{sha256:report.captureSha256,bytes:bytes.length,
      origin:"synthetic-fixture",clearance:"public-synthetic",
      captureVantage:"client",completeness:"midstream"},
    groundTruth:{origin:"synthetic-fixture-author",coverage:"exhaustive",
      blindedToReport:true,reviewerPseudonyms:[],
      expected:[{kind:"syn_observed",frames:[1],confidence:"direct"}]},
    outcomes:[],pricing:{kind:"scenario",priceMinor:"900",currency:"USD"},
    costLines:[],
  };
  return {sample,report,bytes};
}
const pretendHuman=(base:PilotCase):PilotCase=>({
  ...base,
  capture:{...base.capture,origin:"consented-sanitized",
    clearance:"documented-public-clearance",consentRef:"consent_12345"},
  groundTruth:{...base.groundTruth,origin:"independently-adjudicated",
    blindedToReport:true,reviewerPseudonyms:["reviewer_0001","reviewer_0002"]},
  outcomes:[
    {reviewerPseudonym:"reviewer_0001",usefulness:5,
      manualMinutes:20,assistedMinutes:5,wouldPay:true,
      unwarrantedCausalClaims:0,acceptedDeliverable:true},
    {reviewerPseudonym:"reviewer_0002",usefulness:4,
      manualMinutes:18,assistedMinutes:6,wouldPay:false,
      unwarrantedCausalClaims:0,acceptedDeliverable:true},
  ],
});
describe("TCP pilot scoring and go/no-go safety",()=>{
  it("scores manually authored synthetic expectations, but NEVER treats them as customer evidence",async()=>{
    const f=await fixture();
    const score=await Effect.runPromise(evaluateCase(f.bytes,f.sample));
    expect(score).toMatchObject({precision:1,annotatedRecall:1,f1:1,
      tp:1,fp:0,fn:0,costEvidence:"none",actualContributionMinor:null,
      signedObservationExternallyAuthorized:false});
    const summary=summarizePilotProgram([{case:f.sample,score}]);
    expect(summary.decision).toBe("synthetic-calibration-only");
    expect(summary.practitionerCases).toBe(0);
    expect(summary.qualityGates.every(x=>!x.pass)).toBe(true);
  });
  it("penalizes wrong or missing events, without hallucinating performance when annotations are partial",async()=>{
    const {sample,report}=await fixture();
    const wrong={...report,observations:[{kind:"rst_observed" as const,
      frames:[1],confidence:"direct" as const,description:"Direct RST observed"}]};
    const exhaustive=scorePilotCase(sample,wrong);
    expect(exhaustive).toMatchObject({tp:0,fp:1,fn:1,precision:0,annotatedRecall:0,f1:0});
    const partial=scorePilotCase({
      ...sample,groundTruth:{...sample.groundTruth,coverage:"partial"},
    },wrong);
    expect(partial.precision).toBeNull();
    expect(partial.fp).toBeNull();
    expect(partial.f1).toBeNull();
    expect(partial.annotatedRecall).toBe(0);
  });
  it("rejects mismatched capture bytes or analysis version, plus unconsented human evidence",async()=>{
    const f=await fixture();
    const altered=Uint8Array.from(f.bytes);altered[85] ^= 0x1;
    await expect(Effect.runPromise(evaluateCase(altered,f.sample))).rejects.toThrow(PilotError);
    expect(()=>scorePilotCase(f.sample,{...f.report,
      captureSha256:"b".repeat(64)})).toThrow(PilotError);
    const human=pretendHuman(f.sample);
    expect(()=>scorePilotCase({...human,capture:{...human.capture,
      consentRef:undefined}},f.report)).toThrow(PilotError);
    expect(()=>scorePilotCase({...human,groundTruth:{...human.groundTruth,
      reviewerPseudonyms:["reviewer_0001","reviewer_0001"]}},f.report)).toThrow(PilotError);
    expect(()=>scorePilotCase({...f.sample,outcomes:human.outcomes},f.report)).toThrow(PilotError);
  });
  it("does not call modeled contribution actual, even with perfect technical scores",async()=>{
    const f=await fixture();
    const human=pretendHuman(f.sample);
    const sample:PilotCase={...human,costLines:[
      {category:"worker",source:"metered",minorUnits:"8",sourceRef:"meter_0001"},
      {category:"payment",source:"assumption",minorUnits:"40"},
      {category:"review",source:"assumption",minorUnits:"150"},
    ]};
    const scored=scorePilotCase(sample,f.report);
    expect(scored.cogsMinor).toBe("198");
    expect(scored.scenarioContributionMinor).toBe("702");
    expect(scored.actualContributionMinor).toBeNull();
    expect(scored.averageMinutesSaved).toBe(13.5);
    expect(scored.wouldPayFraction).toBe(0.5);
    const summary=summarizePilotProgram([{case:sample,score:scored}]);
    expect(summary.decision).toBe("collect-more-evidence");
    expect(summary.distinctPractitioners).toBe(2);
    expect(summary.actualContributionMinor).toBeNull();
  });
  it("remains conservative when synthetic samples contain no observations",async()=>{
    const f=await fixture();
    const sample:PilotCase={...f.sample,
      groundTruth:{...f.sample.groundTruth,expected:[]}};
    const result=scorePilotCase(sample,{...f.report,observations:[]});
    expect(result.precision).toBe(1);
    expect(result.annotatedRecall).toBe(1);
    expect(result.f1).toBe(1);
    expect(summarizePilotProgram([{case:sample,score:result}])
      .decision).toBe("synthetic-calibration-only");
  });
});
