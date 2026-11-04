import {describe,expect,it} from "vitest";
import {analyzeTcpCapture,evaluateTcpReport,TcpCaptureError} from "../src/index.ts";
import {makeTestPcap} from "@awc/modbus-pcap/testing";

/** Read the packet boundaries instead of depending on the analyzer to create expectations. */
function chunks(pcap:Uint8Array):Uint8Array[]{
  const view=new DataView(pcap.buffer,pcap.byteOffset,pcap.byteLength);
  const frames:Uint8Array[]=[];
  let offset=24;
  while(offset<pcap.length){
    const len=view.getUint32(offset+8,true);
    frames.push(Uint8Array.from(pcap.subarray(offset,offset+16+len)));
    offset+=16+len;
  }
  return frames;
}
function combine(...records:Uint8Array[]):Uint8Array{
  const head=makeTestPcap([]).slice(0,24);
  const out=new Uint8Array(head.length+records.reduce((n,r)=>n+r.length,0));
  out.set(head);let at=head.length;
  for(const r of records){out.set(r,at);at+=r.length;}
  return out;
}
describe("Bounded passive TCP flow analysis",()=>{
  it("reports observed bidirectional flows without inventing TCP path RTT",async()=>{
    const pcap=makeTestPcap([
      {direction:"request",transactionId:1,functionCode:3,timestampMicros:1000},
      {direction:"response",transactionId:1,functionCode:3,timestampMicros:44000},
    ]);
    const report=await analyzeTcpCapture(pcap);
    expect(report.coverage).toMatchObject({totalFrames:2,parsedTcpSegments:2,flowCount:1});
    expect(report.flows[0]).toMatchObject({observedSegments:2,payloadSegments:2,
      repeatedPayloadSegments:0,synFrames:[]});
    expect(report.flows[0]?.synToSynAckMs).toBeUndefined();
    expect(report.findings.find(x=>x.kind==="midstream_capture")).toBeDefined();
    expect((await evaluateTcpReport(pcap,report)).passed).toBe(true);
    expect((await evaluateTcpReport(pcap,{...report,flows:[]})).passed).toBe(false);
  });
  it("identifies exact repeated sequence bytes, not proven packet loss",async()=>{
    const single=makeTestPcap([{direction:"request",transactionId:12,functionCode:3}]);
    const [record]=chunks(single);
    const report=await analyzeTcpCapture(combine(record!,record!));
    expect(report.coverage.parsedTcpSegments).toBe(2);
    expect(report.flows[0]?.repeatedPayloadSegments).toBe(1);
    expect(report.flows[0]?.firstObservedPayloadBytes).toBe(report.flows[0]?.observedPayloadBytes!/2);
    expect(report.findings.some(x=>x.kind==="duplicate_sequence_observed")).toBe(true);
    expect(report.findings.every(x=>!x.description.includes("proven packet loss"))).toBe(true);
  });
  it("does not conflate changed bytes at the same sequence range",async()=>{
    const base=makeTestPcap([{direction:"request",transactionId:12,functionCode:3}]);
    const record=chunks(base)[0]!;
    const changed=Uint8Array.from(record);
    // Packet record (16) + Ethernet(14) + IPv4(20) + TCP(20) + Modbus (7) + function byte.
    changed[16+14+20+20+7]=4;
    const report=await analyzeTcpCapture(combine(record,changed));
    expect(report.findings.some(x=>x.kind==="sequence_payload_changed")).toBe(true);
    expect(report.flows[0]?.repeatedPayloadSegments).toBe(0);
  });
  it("observes zero advertised window and RST without causal attribution",async()=>{
    const base=makeTestPcap([{direction:"request",transactionId:12,functionCode:3}]);
    const record=chunks(base)[0]!;
    const reset=Uint8Array.from(record);
    reset[16+14+20+13]=0x14; // RST+ACK
    reset[16+14+20+14]=0;
    reset[16+14+20+15]=0;
    const report=await analyzeTcpCapture(combine(reset));
    expect(report.flows[0]?.rstFrames).toEqual([1]);
    expect(report.flows[0]?.zeroWindowFrames).toEqual([1]);
    expect(report.findings.map(x=>x.kind)).toContain("connection_reset");
    expect(report.findings.map(x=>x.kind)).toContain("zero_receive_window");
  });
  it("fails closed for pcapng, bad sizes and unsupported Ethernet linktype",async()=>{
    const capture=makeTestPcap([{direction:"request",transactionId:3,functionCode:3}]);
    const pcapng=Uint8Array.from(capture);pcapng.set([0x0a,0x0d,0x0d,0x0a]);
    await expect(analyzeTcpCapture(pcapng)).rejects.toThrow(TcpCaptureError);
    await expect(analyzeTcpCapture(capture.slice(0,-1))).rejects.toThrow();
    await expect(analyzeTcpCapture(new Uint8Array(49*1024))).rejects.toThrow();
    const unknown=Uint8Array.from(capture);
    new DataView(unknown.buffer).setUint32(20,101,true);
    await expect(analyzeTcpCapture(unknown)).rejects.toThrow();
  });
});
