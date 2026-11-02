/**
 * Conservative, bounded TCP *evidence*, not inferred root cause.
 * Classic PCAP Ethernet/IPv4 non-fragmented TCP only; no stream reassembly,
 * SACK/window-scale interpretation, NAT inference or TCP checksum validation.
 */
export const ANALYZER_ID="awc/tcp-pcap@0.1.0" as const;
export const PCAP_MEDIA_TYPE="application/vnd.tcpdump.pcap" as const;
export const MAX_CAPTURE_BYTES=48*1024;
const MAX_FRAMES=500,MAX_FLOWS=96,MAX_OBSERVATIONS=300;
const LIMITATIONS=[
  "Packet observations, not network-path causal attribution or measured packet loss.",
  "Only classic PCAP Ethernet/IPv4 nonfragmented TCP; no IPv6, pcapng, TLS decryption or TCP stream reassembly.",
  "Sequence repeats can be retransmissions, duplicate captures or overlapping segments; no retransmission root cause is asserted.",
  "Sequence gaps and ACKs beyond observed data may reflect capture start, dropped mirror traffic or offload, not network loss.",
  "Window size is the raw 16-bit advertised field, without negotiated window scaling.",
  "SYN-to-SYN/ACK is observed handshake response time, not guaranteed end-to-end RTT.",
  "Payload values are never returned; no HTTP/TLS/application interpretation or device identity assurance."
] as const;
export class TcpCaptureError extends Error{
  readonly _tag="TcpCaptureError";
  constructor(readonly code:"invalid"|"unsupported"|"too_large",message:string){super(message);this.name="TcpCaptureError";}
}
export interface TcpObservation {
  readonly kind:"syn_observed"|"syn_ack_observed"|"rst_observed"|"zero_window_advertised"|
    "duplicate_sequence_range"|"overlapping_sequence_range"|"sequence_gap_observed"|
    "ack_beyond_observed"|"capture_truncated"|"malformed_tcp";
  readonly confidence:"direct"|"capture_limited"|"heuristic";
  readonly flowId?:string;
  readonly frames:readonly number[];
  readonly description:string;
}
export interface TcpSegmentEvidence {
  readonly frame:number; readonly timestampMicros:number;
  readonly source:string; readonly destination:string;
  readonly sourcePort:number; readonly destinationPort:number;
  readonly flowId:string; readonly sequence:number; readonly acknowledgment:number;
  readonly syn:boolean; readonly ack:boolean; readonly fin:boolean; readonly rst:boolean;
  readonly advertisedWindow:number; readonly payloadBytes:number;
}
export interface TcpFlow {
  readonly id:string;
  readonly endpointA:string;readonly endpointB:string;
  readonly firstFrame:number;readonly lastFrame:number;
  readonly packets:number;readonly payloadBytesObserved:number;
  readonly synPackets:number;readonly synAckPackets:number;
  readonly finPackets:number;readonly rstPackets:number;
  readonly zeroWindowAdvertisements:number;
  readonly duplicateRanges:number;readonly overlappingRanges:number;readonly observedGaps:number;
  readonly handshakeSynToSynAckMs?:number;
}
export interface TcpReport {
  readonly schemaVersion:"awc.tcp.packet-evidence/v1";
  readonly analyzer:typeof ANALYZER_ID;
  readonly captureSha256:string;
  readonly coverage:{
    readonly totalFrames:number;readonly tcpFrames:number;readonly skippedFrames:number;
    readonly truncatedFrames:number;readonly flows:number;
    readonly captureStartMidstreamPossible:boolean;
  };
  readonly flows:readonly TcpFlow[];
  readonly segments:readonly TcpSegmentEvidence[];
  readonly observations:readonly TcpObservation[];
  readonly limitations:readonly string[];
}
type Endpoint={ip:string;port:number};
type Range={start:number;end:number;frame:number};
type Direction={
  expected?:number;
  highestObserved?:number;
  ranges:Range[];
};
type MutableFlow={
  id:string;endpointA:string;endpointB:string;firstFrame:number;lastFrame:number;
  packets:number;payloadBytesObserved:number;synPackets:number;synAckPackets:number;
  finPackets:number;rstPackets:number;zeroWindowAdvertisements:number;
  duplicateRanges:number;overlappingRanges:number;observedGaps:number;
  synAt?:number;synFrom?:string;handshakeSynToSynAckMs?:number;
  a:Direction;b:Direction;seenSyn:boolean;
};
const u16=(b:Uint8Array,p:number)=>(b[p]!<<8)|b[p+1]!;
const u32=(b:Uint8Array,p:number)=>((b[p]!*2**24)+(b[p+1]!<<16)+(b[p+2]!<<8)+b[p+3]!)>>>0;
const ip=(b:Uint8Array,p:number)=>Array.from(b.subarray(p,p+4)).join(".");
const hash=async(raw:Uint8Array)=>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256",Uint8Array.from(raw)))]
    .map(x=>x.toString(16).padStart(2,"0")).join("");
const round=(v:number)=>Math.round(v*1000)/1000;
const sequenceAdd=(seq:number,n:number)=>(seq+n)>>>0;
/** Compare 32-bit serial sequence numbers only within the half-space. */
const seqDifference=(a:number,b:number)=>((a-b+2**31)>>>0)-2**31;
/** Preserve a canonical endpoint ordering without guessing "client" for a midstream capture. */
const canonical=(x:Endpoint,y:Endpoint)=>{
  const a=x.ip+":"+x.port,b=y.ip+":"+y.port;
  return a<=b?[a,b,true] as const:[b,a,false] as const;
};
export async function analyzeTcpPcap(raw:Uint8Array):Promise<TcpReport>{
  if(raw.length>MAX_CAPTURE_BYTES)throw new TcpCaptureError("too_large","48 KiB TCP pilot input limit");
  if(raw.length<24)throw new TcpCaptureError("invalid","Missing classic PCAP global header");
  const magic=Array.from(raw.subarray(0,4)).map(n=>n.toString(16).padStart(2,"0")).join("");
  const formats:Record<string,{little:boolean;nano:boolean}>={
    d4c3b2a1:{little:true,nano:false},a1b2c3d4:{little:false,nano:false},
    "4d3cb2a1":{little:true,nano:true},a1b23c4d:{little:false,nano:true},
  };
  const format=formats[magic];
  if(!format)throw new TcpCaptureError("unsupported","Only classic PCAP 2.4 supported, not pcapng");
  const view=new DataView(raw.buffer,raw.byteOffset,raw.byteLength);
  const read16=(p:number)=>view.getUint16(p,format.little);
  const read32=(p:number)=>view.getUint32(p,format.little);
  if(read16(4)!==2||read16(6)!==4||read32(20)!==1)
    throw new TcpCaptureError("unsupported","PCAP must be version 2.4 Ethernet LINKTYPE 1");
  const snaplen=read32(16);
  if(snaplen<14||snaplen>65535)throw new TcpCaptureError("invalid","Invalid PCAP snaplen");
  let cursor=24,totalFrames=0,tcpFrames=0,skippedFrames=0,truncatedFrames=0;
  const seen=new Map<string,MutableFlow>(),observations:TcpObservation[]=[];
  const segments:TcpSegmentEvidence[]=[];
  const add=(ob:TcpObservation)=>{
    if(observations.length>=MAX_OBSERVATIONS)throw new TcpCaptureError("too_large","Too many TCP observations");
    observations.push(ob);
  };
  const note=(kind:TcpObservation["kind"],confidence:TcpObservation["confidence"],
    frames:number[],description:string,flow?:MutableFlow)=>{
    add({kind,confidence,frames,description,...(flow?{flowId:flow.id}:{})});
  };
  while(cursor<raw.length){
    if(++totalFrames>MAX_FRAMES)throw new TcpCaptureError("too_large","Too many frames");
    if(cursor+16>raw.length)throw new TcpCaptureError("invalid","Truncated PCAP record header");
    const sec=read32(cursor),sub=read32(cursor+4),included=read32(cursor+8),original=read32(cursor+12);
    if(included===0||included>snaplen||included>original||cursor+16+included>raw.length)
      throw new TcpCaptureError("invalid","Invalid PCAP record length");
    if(sub>=(format.nano?1_000_000_000:1_000_000))
      throw new TcpCaptureError("invalid","Invalid PCAP timestamp fraction");
    cursor+=16;
    const packet=raw.subarray(cursor,cursor+included);
    cursor+=included;
    const timestamp=sec*1_000_000+Math.floor(sub/(format.nano?1000:1));
    if(included<original){
      truncatedFrames++;
      note("capture_truncated","capture_limited",[totalFrames],
        "Frame was truncated by capture snaplen; stream inference is unreliable");
    }
    if(packet.length<14){skippedFrames++;continue;}
    let etherType=u16(packet,12),network=14;
    for(let tags=0;tags<2&&[0x8100,0x88a8].includes(etherType);tags++){
      if(packet.length<network+4)break;
      etherType=u16(packet,network+2);network+=4;
    }
    if(etherType!==0x0800||packet.length<network+20){skippedFrames++;continue;}
    const ihl=(packet[network]!&15)*4,total=u16(packet,network+2);
    if(packet[network]!>>4!==4||ihl<20||total<ihl||packet.length<network+ihl){
      skippedFrames++;continue;
    }
    if(packet[network+9]!==6||(u16(packet,network+6)&0x3fff)!==0){skippedFrames++;continue;}
    const tcp=network+ihl,ipEnd=Math.min(packet.length,network+total);
    if(ipEnd<tcp+20){skippedFrames++;continue;}
    const src={ip:ip(packet,network+12),port:u16(packet,tcp)};
    const dst={ip:ip(packet,network+16),port:u16(packet,tcp+2)};
    const [a,b,fromA]=canonical(src,dst),key=a+"|"+b;
    const flags=packet[tcp+13]!,syn=(flags&0x02)!==0,ack=(flags&0x10)!==0;
    const fin=(flags&0x01)!==0,rst=(flags&0x04)!==0;
    const header=(packet[tcp+12]!>>4)*4;
    if(header<20||ipEnd<tcp+header){
      note("malformed_tcp","direct",[totalFrames],"TCP data offset is inconsistent with captured IPv4 length");
      skippedFrames++;continue;
    }
    if(!seen.has(key)){
      if(seen.size>=MAX_FLOWS)throw new TcpCaptureError("too_large","Too many TCP flows");
      seen.set(key,{id:"flow:"+String(seen.size+1),endpointA:a,endpointB:b,
        firstFrame:totalFrames,lastFrame:totalFrames,packets:0,payloadBytesObserved:0,
        synPackets:0,synAckPackets:0,finPackets:0,rstPackets:0,
        zeroWindowAdvertisements:0,duplicateRanges:0,overlappingRanges:0,observedGaps:0,
        a:{ranges:[]},b:{ranges:[]},seenSyn:false});
    }
    const flow=seen.get(key)!;
    const direction=fromA?flow.a:flow.b;
    const reverse=fromA?flow.b:flow.a;
    tcpFrames++;flow.packets++;flow.lastFrame=totalFrames;
    const window=u16(packet,tcp+14),seq=u32(packet,tcp+4),ackNo=u32(packet,tcp+8);
    const payloadLength=ipEnd-tcp-header;
    flow.payloadBytesObserved+=payloadLength;
    segments.push({
      frame:totalFrames,timestampMicros:timestamp,source:src.ip,destination:dst.ip,
      sourcePort:src.port,destinationPort:dst.port,flowId:flow.id,
      sequence:seq,acknowledgment:ackNo,syn,ack,fin,rst,
      advertisedWindow:window,payloadBytes:payloadLength,
    });
    if(syn){
      flow.synPackets++;
      flow.seenSyn=true;
      if(!ack){
        note("syn_observed","direct",[totalFrames],"TCP SYN observed",flow);
        if(flow.synAt===undefined){flow.synAt=timestamp;flow.synFrom=fromA?"a":"b";}
      }else{
        flow.synAckPackets++;
        note("syn_ack_observed","direct",[totalFrames],"TCP SYN/ACK observed",flow);
        if(flow.handshakeSynToSynAckMs===undefined&&flow.synAt!==undefined&&
          flow.synFrom!==(fromA?"a":"b")&&timestamp>=flow.synAt)
          flow.handshakeSynToSynAckMs=round((timestamp-flow.synAt)/1000);
      }
    }
    if(fin)flow.finPackets++;
    if(rst){flow.rstPackets++;note("rst_observed","direct",[totalFrames],
      "TCP RST flag observed; cause cannot be inferred from a packet alone",flow);}
    if(window===0){
      flow.zeroWindowAdvertisements++;
      note("zero_window_advertised","direct",[totalFrames],
        "TCP advertised receive window field is zero",flow);
    }
    if(ack&&reverse.highestObserved!==undefined&&
       seqDifference(ackNo,reverse.highestObserved)>0)
      note("ack_beyond_observed","capture_limited",[totalFrames],
        "ACK covers bytes not visible in the captured reverse-direction sequence ranges",flow);
    const occupies=payloadLength+(syn?1:0)+(fin?1:0);
    if(occupies>0){
      const end=sequenceAdd(seq,occupies);
      const previous=direction.ranges.find(r=>r.start===seq&&r.end===end);
      if(previous){
        flow.duplicateRanges++;
        note("duplicate_sequence_range","heuristic",[previous.frame,totalFrames],
          "Identical TCP sequence range observed twice; retransmission not proven",flow);
      }else{
        const overlap=direction.ranges.find(r=>{
          // Skip cross-wrap range analysis: no reliable ordering without an ISN.
          if(r.end<r.start||end<seq)return false;
          return seq<r.end&&r.start<end;
        });
        if(overlap){
          flow.overlappingRanges++;
          note("overlapping_sequence_range","heuristic",[overlap.frame,totalFrames],
            "TCP sequence ranges overlap; cause unverified",flow);
        }else if(direction.expected!==undefined&&seqDifference(seq,direction.expected)>0){
          flow.observedGaps++;
          note("sequence_gap_observed","capture_limited",[totalFrames],
            "Next observed segment begins beyond the sequence range previously captured",flow);
        }
      }
      if(direction.ranges.length>=MAX_FRAMES)throw new TcpCaptureError("too_large","Too many intervals");
      direction.ranges.push({start:seq,end,frame:totalFrames});
      if(direction.expected===undefined||seqDifference(end,direction.expected)>0)
        direction.expected=end;
      if(direction.highestObserved===undefined||seqDifference(end,direction.highestObserved)>0)
        direction.highestObserved=end;
    }
  }
  const flows:TcpFlow[]=[...seen.values()].map(f=>({
    id:f.id,endpointA:f.endpointA,endpointB:f.endpointB,firstFrame:f.firstFrame,
    lastFrame:f.lastFrame,packets:f.packets,payloadBytesObserved:f.payloadBytesObserved,
    synPackets:f.synPackets,synAckPackets:f.synAckPackets,finPackets:f.finPackets,
    rstPackets:f.rstPackets,zeroWindowAdvertisements:f.zeroWindowAdvertisements,
    duplicateRanges:f.duplicateRanges,overlappingRanges:f.overlappingRanges,
    observedGaps:f.observedGaps,
    ...(f.handshakeSynToSynAckMs===undefined?{}:{handshakeSynToSynAckMs:f.handshakeSynToSynAckMs}),
  }));
  return {schemaVersion:"awc.tcp.packet-evidence/v1",analyzer:ANALYZER_ID,
    captureSha256:await hash(raw),
    coverage:{totalFrames,tcpFrames,skippedFrames,truncatedFrames,flows:flows.length,
      captureStartMidstreamPossible:[...seen.values()].some(f=>!f.seenSyn)},
    flows,segments,observations,limitations:[...LIMITATIONS]};
}
/** Version-bound consistency check. Same implementation is NOT independent professional review. */
export async function evaluateTcpReport(input:Uint8Array,untrusted:unknown){
  const expected=await analyzeTcpPcap(input);
  const observed=JSON.stringify(untrusted);
  if(observed.length>120_000)throw new TcpCaptureError("too_large","Report too large");
  return {passed:JSON.stringify(expected)===observed,report:expected,
    checks:["capture_digest","ipv4_tcp_fields","sequence_ranges","handshake_flags","bounded_limitations"] as const,
    reportDigest:await hash(new TextEncoder().encode(JSON.stringify(expected)))};
}
