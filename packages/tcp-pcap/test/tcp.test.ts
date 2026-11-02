import {describe,expect,it} from "vitest";
import {analyzeTcpPcap,evaluateTcpReport,TcpCaptureError} from "../src/index.ts";

/** Different fixture builder from the production parser; integer fields deliberately explicit. */
type Packet={src?:number;dst?:number;sport?:number;dport?:number;seq:number;ack?:number;
  flags:number;window?:number;data?:Uint8Array;timeUs?:number};
const be16=(v:DataView,p:number,n:number)=>v.setUint16(p,n,false);
const be32=(v:DataView,p:number,n:number)=>v.setUint32(p,n>>>0,false);
function pcap(packets:Packet[]):Uint8Array{
  const header=new Uint8Array(24),view=new DataView(header.buffer);
  view.setUint32(0,0xa1b2c3d4,true);view.setUint16(4,2,true);view.setUint16(6,4,true);
  view.setUint32(16,65535,true);view.setUint32(20,1,true);
  const pieces=[header];
  packets.forEach((p,i)=>{
    const data=p.data??new Uint8Array(),frame=new Uint8Array(54+data.length);
    const d=new DataView(frame.buffer);
    be16(d,12,0x0800);frame[14]=0x45;be16(d,16,40+data.length);
    frame[22]=64;frame[23]=6;
    frame.set([192,0,2,p.src??10],26);frame.set([192,0,2,p.dst??20],30);
    be16(d,34,p.sport??40000);be16(d,36,p.dport??502);
    be32(d,38,p.seq);be32(d,42,p.ack??0);frame[46]=0x50;
    frame[47]=p.flags;be16(d,48,p.window??8192);frame.set(data,54);
    const record=new Uint8Array(16),r=new DataView(record.buffer);
    r.setUint32(0,1700000000,true);r.setUint32(4,p.timeUs??i*10000,true);
    r.setUint32(8,frame.length,true);r.setUint32(12,frame.length,true);
    pieces.push(record,frame);
  });
  const length=pieces.reduce((n,x)=>n+x.length,0),out=new Uint8Array(length);
  let at=0;for(const part of pieces){out.set(part,at);at+=part.length;}return out;
}
describe("conservative TCP packet evidence",()=>{
  it("measures SYN-to-SYN/ACK, zero-window and RST as direct observations",async()=>{
    const b=pcap([
      {seq:100,flags:0x02,timeUs:1000},
      {src:20,dst:10,sport:502,dport:40000,seq:900,ack:101,flags:0x12,timeUs:31000},
      {seq:101,ack:901,flags:0x10,timeUs:35000},
      {src:20,dst:10,sport:502,dport:40000,seq:901,ack:101,flags:0x14,window:0,timeUs:46000},
    ]);
    const r=await analyzeTcpPcap(b);
    expect(r.coverage.tcpFrames).toBe(4);
    expect(r.flows).toHaveLength(1);
    expect(r.flows[0]).toMatchObject({synPackets:2,synAckPackets:1,
      handshakeSynToSynAckMs:30,rstPackets:1,zeroWindowAdvertisements:1});
    expect(r.observations.map(x=>x.kind)).toContain("zero_window_advertised");
    expect(r.observations.map(x=>x.kind)).toContain("rst_observed");
    expect((await evaluateTcpReport(b,r)).passed).toBe(true);
    expect((await evaluateTcpReport(b,{...r,flows:[]})).passed).toBe(false);
  });
  it("labels duplicate ranges and observed gaps without claiming lost packets",async()=>{
    const data=new Uint8Array([1,2,3,4]);
    const r=await analyzeTcpPcap(pcap([
      {seq:1000,flags:0x18,data,timeUs:0},
      {seq:1000,flags:0x18,data,timeUs:2000},
      {seq:1012,flags:0x18,data,timeUs:6000},
    ]));
    expect(r.flows[0]?.duplicateRanges).toBe(1);
    expect(r.flows[0]?.observedGaps).toBe(1);
    expect(r.coverage.captureStartMidstreamPossible).toBe(true);
    expect(r.observations.find(x=>x.kind==="duplicate_sequence_range")?.confidence).toBe("heuristic");
    expect(JSON.stringify(r)).not.toMatch(/packet_loss_confirmed|retransmission_proven/);
  });
  it("rejects pcapng, overlarge captures and broken packet records",async()=>{
    const b=pcap([{seq:1,flags:0x02}]);
    const broken=Uint8Array.from(b);broken[32]=0xff; // PCAP incl_len > orig_len
    await expect(analyzeTcpPcap(broken)).rejects.toThrow(TcpCaptureError);
    const pcapng=Uint8Array.from(b);pcapng.set([10,13,13,10],0);
    await expect(analyzeTcpPcap(pcapng)).rejects.toThrow(TcpCaptureError);
    await expect(analyzeTcpPcap(new Uint8Array(48*1024+1))).rejects.toThrow();
  });
});
