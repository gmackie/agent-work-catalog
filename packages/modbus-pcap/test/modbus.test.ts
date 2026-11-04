import {describe,expect,it} from "vitest";
import {analyzeClassicPcap,evaluatePcapReport,CaptureError} from "../src/index.ts";
import {makeTestPcap} from "../src/testing.ts";

describe("real, bounded Modbus/TCP PCAP analysis",()=>{
  it("pairs transaction IDs, computes capture-relative latency and detects exception responses",async()=>{
    const raw=makeTestPcap([
      {direction:"request",transactionId:42,functionCode:3,timestampMicros:10000},
      {direction:"response",transactionId:42,functionCode:3,exceptionCode:2,timestampMicros:55000},
      {direction:"request",transactionId:43,functionCode:4,timestampMicros:65000},
    ]);
    const report=await analyzeClassicPcap(raw);
    expect(report.coverage).toEqual({totalFrames:3,tcpSegments:3,parsedAdus:3,skippedFrames:0,incompleteSegments:0});
    expect(report.transactions).toHaveLength(2);
    expect(report.transactions[0]).toMatchObject({transactionId:42,functionCode:3,requestFrame:1,
      responseFrame:2,elapsedMs:45,exceptionCode:2});
    expect(report.findings.map(x=>x.kind)).toEqual(["exception_response","unanswered_observed"]);
    expect(report.findings[1]?.confidence).toBe("limited_capture");
  });
  it("recomputes every field and rejects a provider-forged exception",async()=>{
    const bytes=makeTestPcap([{direction:"request",transactionId:8,functionCode:3},
      {direction:"response",transactionId:8,functionCode:3}]);
    const report=await analyzeClassicPcap(bytes);
    expect((await evaluatePcapReport(bytes,report)).passed).toBe(true);
    const tampered={...report,coverage:{...report.coverage,parsedAdus:999}};
    expect((await evaluatePcapReport(bytes,tampered)).passed).toBe(false);
  });
  it("rejects pcapng, malformed record sizes and oversized captures",async()=>{
    const fixture=makeTestPcap([{direction:"request",transactionId:1,functionCode:3}]);
    const pcapng=Uint8Array.from(fixture);pcapng.set([0x0a,0x0d,0x0d,0x0a],0);
    await expect(analyzeClassicPcap(pcapng)).rejects.toThrow(CaptureError);
    const truncated=fixture.subarray(0,fixture.length-1);
    await expect(analyzeClassicPcap(truncated)).rejects.toThrow();
    await expect(analyzeClassicPcap(new Uint8Array(48*1024+1))).rejects.toThrow();
  });
});
