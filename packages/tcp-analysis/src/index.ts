/**
 * Evidence-first TCP flow analysis for SMALL classic-PCAP Ethernet/IPv4 captures.
 *
 * Not a TCP stack. Does not infer packet loss, root cause, end-to-end RTT or
 * retransmission certainty from an incomplete, possibly mirrored capture.
 * No stream reassembly, TLS decryption, checksum validation, IPv6 or pcapng.
 */
export const TCP_ANALYZER_ID = "awc/tcp-flow-evidence@0.1.0" as const;
export const TCP_REPORT_SCHEMA = "awc.tcp.flow-evidence/v1" as const;
export const MAX_TCP_CAPTURE_BYTES = 48 * 1024;
export const MAX_TCP_FRAMES = 500;
const MAX_FLOWS = 80, MAX_FINDINGS = 250;

export class TcpCaptureError extends Error {
  readonly _tag = "TcpCaptureError";
  constructor(
    readonly code:"invalid"|"unsupported"|"too_large",
    message:string
  ) {super(message);this.name="TcpCaptureError";}
}
export type TcpFindingKind =
  "duplicate_sequence_observed" | "sequence_payload_changed" |
  "possible_sequence_gap" | "overlapping_sequence_range" |
  "zero_receive_window" | "connection_reset" |
  "midstream_capture" | "sequence_wrap_ambiguous" |
  "truncated_ipv4_frame" | "partial_tcp_header";

export interface TcpFinding {
  readonly kind:TcpFindingKind;
  readonly confidence:"observed"|"heuristic"|"incomplete_capture";
  readonly flowId?:string;
  readonly frames:readonly number[];
  readonly description:string;
}
export interface TcpFlow {
  readonly id:string;
  readonly endpointA:string;
  readonly endpointB:string;
  readonly firstFrame:number;
  readonly lastFrame:number;
  readonly observedSegments:number;
  readonly payloadSegments:number;
  readonly observedPayloadBytes:number;
  readonly firstObservedPayloadBytes:number;
  readonly repeatedPayloadSegments:number;
  readonly overlappingSegments:number;
  readonly possibleSequenceGaps:number;
  readonly synFrames:readonly number[];
  readonly synAckFrames:readonly number[];
  readonly finFrames:readonly number[];
  readonly rstFrames:readonly number[];
  readonly zeroWindowFrames:readonly number[];
  readonly synToSynAckMs?:number;
  readonly observationLimitations:readonly string[];
}
export interface TcpEvidenceReport {
  readonly schemaVersion:typeof TCP_REPORT_SCHEMA;
  readonly analyzer:typeof TCP_ANALYZER_ID;
  readonly captureSha256:string;
  readonly coverage:{
    readonly totalFrames:number;
    readonly parsedTcpSegments:number;
    readonly skippedFrames:number;
    readonly truncatedFrames:number;
    readonly flowCount:number;
  };
  readonly flows:readonly TcpFlow[];
  readonly findings:readonly TcpFinding[];
  readonly limitations:readonly string[];
}
export const TCP_LIMITATIONS=[
  "Only classic-PCAP Ethernet / IPv4, complete nonfragmented TCP segments are analyzed.",
  "This is a packet-level observation, not full TCP reassembly, loss attribution, or a congestion-control simulation.",
  "Repeated sequence+payload bytes may indicate retransmission or duplicate capture; neither proves network loss.",
  "Sequence gaps may reflect truncated or partial capture, out-of-order delivery, or unobserved packets.",
  "SYN-to-SYN/ACK elapsed time is capture-point timing, not guaranteed network RTT or server processing time.",
  "TCP checksum validity, window scaling, SACK, timestamp options and payload/application protocols are not interpreted.",
  "32-bit TCP sequence number wrap and reused flow tuples are not resolved as independent sessions.",
  "Output includes observed IP addresses and ports; captures may contain confidential operational metadata."
] as const;

type DirectionState = {maxEnd:number|undefined; ranges:Map<string,string>};
type InternalFlow={
  a:string;b:string;firstFrame:number;lastFrame:number;
  observedSegments:number;payloadSegments:number;
  observedPayloadBytes:number;firstObservedPayloadBytes:number;
  repeatedPayloadSegments:number;overlappingSegments:number;possibleSequenceGaps:number;
  synFrames:number[];synAckFrames:number[];finFrames:number[];
  rstFrames:number[];zeroWindowFrames:number[];
  firstSynMicros:number|undefined;synToSynAckMs:number|undefined;
  observedDirections:Set<string>;states:Map<string,DirectionState>;
  wrapAmbiguous:boolean;midstream:boolean;
};
const be16=(data:Uint8Array,n:number)=>((data[n]??0)<<8)|(data[n+1]??0);
const be32=(data:Uint8Array,n:number)=>(((data[n]??0)*0x1000000)+
  ((data[n+1]??0)<<16)+((data[n+2]??0)<<8)+(data[n+3]??0))>>>0;
const addr=(bytes:Uint8Array,at:number)=>[0,1,2,3].map(x=>bytes[at+x]??0).join(".");
const roundMillis=(value:number)=>Math.round(value*1000)/1000;
const contentHash=async(bytes:Uint8Array):Promise<string>=>{
  const hashed=new Uint8Array(await crypto.subtle.digest("SHA-256",Uint8Array.from(bytes)));
  return [...hashed].map(x=>x.toString(16).padStart(2,"0")).join("");
};
export const tcpCaptureSha256=contentHash;
/** Non-cryptographic per-segment fingerprint, used ONLY to distinguish exact bytes locally. */
const segmentBytes=(bytes:Uint8Array)=>
  Array.from(bytes,number=>number.toString(16).padStart(2,"0")).join("");

export async function analyzeTcpCapture(raw:Uint8Array):Promise<TcpEvidenceReport>{
  if(raw.byteLength>MAX_TCP_CAPTURE_BYTES)
    throw new TcpCaptureError("too_large","TCP pilot input exceeds 48KiB");
  if(raw.byteLength<24)throw new TcpCaptureError("invalid","Incomplete PCAP global header");
  const magic=segmentBytes(raw.subarray(0,4));
  const formats:Record<string,{le:boolean,nanos:boolean}>={
    "d4c3b2a1":{le:true,nanos:false},
    "a1b2c3d4":{le:false,nanos:false},
    "4d3cb2a1":{le:true,nanos:true},
    "a1b23c4d":{le:false,nanos:true},
  };
  const format=formats[magic];
  if(!format)throw new TcpCaptureError("unsupported","Classic PCAP required (no pcapng)");
  const view=new DataView(raw.buffer,raw.byteOffset,raw.byteLength);
  const short=(at:number)=>view.getUint16(at,format.le);
  const integer=(at:number)=>view.getUint32(at,format.le);
  if(short(4)!==2||short(6)!==4)
    throw new TcpCaptureError("unsupported","PCAP version must be 2.4");
  const snaplen=integer(16),network=integer(20)&0xffff;
  if(network!==1)throw new TcpCaptureError("unsupported","Only Ethernet linktype 1 is supported");
  if(snaplen<14||snaplen>65535)throw new TcpCaptureError("invalid","Invalid PCAP snaplen");

  let offset=24,frame=0,parsedTcpSegments=0,skippedFrames=0,truncatedFrames=0;
  const flows=new Map<string,InternalFlow>();
  const findings:TcpFinding[]=[];
  const emit=(kind:TcpFindingKind,confidence:TcpFinding["confidence"],frames:number[],
    description:string,flowId?:string)=>{
    if(findings.length>=MAX_FINDINGS)
      throw new TcpCaptureError("too_large","Too many TCP findings in capture");
    findings.push({kind,confidence,frames,description,...(flowId?{flowId}:{})});
  };
  while(offset<raw.length){
    frame++;
    if(frame>MAX_TCP_FRAMES)throw new TcpCaptureError("too_large","Capture exceeds 500 frames");
    if(raw.length-offset<16)throw new TcpCaptureError("invalid","Incomplete packet record");
    const sec=integer(offset),fract=integer(offset+4),
      included=integer(offset+8),original=integer(offset+12);
    if(included===0||included>original||included>snaplen||included>raw.length-offset-16)
      throw new TcpCaptureError("invalid","Invalid PCAP frame length");
    if(fract>=(format.nanos?1_000_000_000:1_000_000))
      throw new TcpCaptureError("invalid","Invalid subsecond timestamp");
    offset+=16;
    const packet=raw.subarray(offset,offset+included);
    offset+=included;
    const micros=sec*1_000_000 + fract/(format.nanos?1000:1);
    if(packet.length<14){skippedFrames++;continue;}
    let type=be16(packet,12),networkAt=14,vlan=0;
    while((type===0x8100||type===0x88a8)&&vlan<2){
      if(packet.length<networkAt+4){break;}
      type=be16(packet,networkAt+2);
      networkAt+=4;vlan++;
    }
    if(type!==0x0800){skippedFrames++;continue;}
    if(packet.length<networkAt+20){truncatedFrames++;continue;}
    const version=packet[networkAt]!>>4,ihl=(packet[networkAt]!&15)*4;
    const ipLen=be16(packet,networkAt+2);
    if(version!==4||ihl<20||networkAt+ihl>packet.length||ipLen<ihl){
      truncatedFrames++;continue;
    }
    if((be16(packet,networkAt+6)&0x3fff)!==0||packet[networkAt+9]!==6){
      skippedFrames++;continue;
    }
    if(networkAt+ipLen>packet.length){
      truncatedFrames++;
      emit("truncated_ipv4_frame","incomplete_capture",[frame],
        "Captured Ethernet frame does not contain all advertised IPv4 bytes");
      continue;
    }
    const tcpAt=networkAt+ihl,end=networkAt+ipLen;
    if(end-tcpAt<20){truncatedFrames++;continue;}
    const tcpLen=(packet[tcpAt+12]!>>4)*4;
    if(tcpLen<20||tcpAt+tcpLen>end){
      truncatedFrames++;
      emit("partial_tcp_header","incomplete_capture",[frame],
        "TCP header length is invalid or outside the captured IP datagram");
      continue;
    }
    const src=addr(packet,networkAt+12),dst=addr(packet,networkAt+16),
      sport=be16(packet,tcpAt),dport=be16(packet,tcpAt+2),
      seq=be32(packet,tcpAt+4),flags=packet[tcpAt+13]!,
      window=be16(packet,tcpAt+14);
    const syn=(flags&0x02)!==0,ack=(flags&0x10)!==0,
      rst=(flags&0x04)!==0,fin=(flags&0x01)!==0;
    const from=src+":"+sport,to=dst+":"+dport;
    const a=from<to?from:to,b=from<to?to:from,id=a+"|"+b;
    let flow=flows.get(id);
    if(!flow){
      if(flows.size>=MAX_FLOWS)throw new TcpCaptureError("too_large","Too many TCP flows");
      flow={
        a,b,firstFrame:frame,lastFrame:frame,
        observedSegments:0,payloadSegments:0,observedPayloadBytes:0,
        firstObservedPayloadBytes:0,repeatedPayloadSegments:0,
        overlappingSegments:0,possibleSequenceGaps:0,
        synFrames:[],synAckFrames:[],finFrames:[],rstFrames:[],zeroWindowFrames:[],
        firstSynMicros:undefined,synToSynAckMs:undefined,
        observedDirections:new Set(),states:new Map(),wrapAmbiguous:false,midstream:!syn,
      };
      flows.set(id,flow);
      if(!syn)emit("midstream_capture","incomplete_capture",[frame],
        "This flow was first observed without an initial SYN; handshake and sequence history may be missing",id);
    }
    flow.observedDirections.add(from);
    flow.lastFrame=frame;
    flow.observedSegments++;
    parsedTcpSegments++;
    if(syn&&ack){
      flow.synAckFrames.push(frame);
      if(flow.firstSynMicros!==undefined&&micros>=flow.firstSynMicros){
        flow.synToSynAckMs ??=roundMillis((micros-flow.firstSynMicros)/1000);
      }
    }else if(syn){flow.synFrames.push(frame);flow.firstSynMicros??=micros;}
    if(fin)flow.finFrames.push(frame);
    if(rst){
      flow.rstFrames.push(frame);
      emit("connection_reset","observed",[frame],
        "TCP RST flag is present; its cause and acceptability were not established",id);
    }
    if(window===0&&!syn){
      flow.zeroWindowFrames.push(frame);
      emit("zero_receive_window","observed",[frame],
        "TCP header advertises zero receive-window field; scaling and peer behavior are not evaluated",id);
    }
    const payload=packet.subarray(tcpAt+tcpLen,end);
    if(payload.length===0)continue;
    flow.payloadSegments++;
    flow.observedPayloadBytes+=payload.length;
    const direction=from+">"+to;
    let state=flow.states.get(direction);
    if(!state){state={maxEnd:undefined,ranges:new Map()};flow.states.set(direction,state);}
    if(seq+payload.length>0xffff_ffff){
      flow.wrapAmbiguous=true;
      emit("sequence_wrap_ambiguous","incomplete_capture",[frame],
        "Sequence range crosses 32-bit wrap; classification suspended",id);
      continue;
    }
    const range=seq+":"+payload.length;
    const bytes=segmentBytes(payload);
    const prior=state.ranges.get(range);
    if(prior!==undefined){
      if(prior===bytes){
        flow.repeatedPayloadSegments++;
        emit("duplicate_sequence_observed","observed",[frame],
          "Exact sequence range and payload were seen before; retransmission or duplicate capture is possible",id);
      }else{
        flow.overlappingSegments++;
        emit("sequence_payload_changed","observed",[frame],
          "Previously observed TCP sequence range contains different payload bytes",id);
      }
      continue;
    }
    state.ranges.set(range,bytes);
    flow.firstObservedPayloadBytes+=payload.length;
    if(state.maxEnd!==undefined){
      if(seq>state.maxEnd){
        flow.possibleSequenceGaps++;
        emit("possible_sequence_gap","heuristic",[frame],
          "Sequence number advances beyond observed contiguous bytes; capture gaps are possible",id);
      }else if(seq<state.maxEnd){
        flow.overlappingSegments++;
        emit("overlapping_sequence_range","observed",[frame],
          "New TCP payload range overlaps an earlier observed range; no loss attribution",id);
      }
    }
    const endSeq=seq+payload.length;
    state.maxEnd=Math.max(state.maxEnd??endSeq,endSeq);
  }
  const summaries:TcpFlow[]=[...flows.entries()].map(([id,f])=>({
    id,endpointA:f.a,endpointB:f.b,firstFrame:f.firstFrame,lastFrame:f.lastFrame,
    observedSegments:f.observedSegments,payloadSegments:f.payloadSegments,
    observedPayloadBytes:f.observedPayloadBytes,
    firstObservedPayloadBytes:f.firstObservedPayloadBytes,
    repeatedPayloadSegments:f.repeatedPayloadSegments,
    overlappingSegments:f.overlappingSegments,
    possibleSequenceGaps:f.possibleSequenceGaps,
    synFrames:f.synFrames,synAckFrames:f.synAckFrames,finFrames:f.finFrames,
    rstFrames:f.rstFrames,zeroWindowFrames:f.zeroWindowFrames,
    ...(f.synToSynAckMs===undefined?{}:{synToSynAckMs:f.synToSynAckMs}),
    observationLimitations:[
      ...(f.midstream?["Initial SYN not observed; captures may begin mid-connection"]:[]),
      ...(f.wrapAmbiguous?["Sequence wrap present; sequence comparison may be incomplete"]:[]),
    ],
  })).sort((a,b)=>a.firstFrame-b.firstFrame||a.id.localeCompare(b.id));
  return {schemaVersion:TCP_REPORT_SCHEMA,analyzer:TCP_ANALYZER_ID,
    captureSha256:await contentHash(raw),
    coverage:{totalFrames:frame,parsedTcpSegments,skippedFrames,truncatedFrames,flowCount:summaries.length},
    flows:summaries,findings,limitations:[...TCP_LIMITATIONS]};
}
/** Consistency evaluation only, not independent professional review. */
export async function evaluateTcpReport(raw:Uint8Array,claim:unknown):Promise<{
  passed:boolean;expected:TcpEvidenceReport;expectedDigest:string;observedDigest:string;
}>{
  const expected=await analyzeTcpCapture(raw);
  const left=JSON.stringify(expected),right=JSON.stringify(claim);
  if(right.length>120000)throw new TcpCaptureError("too_large","TCP report exceeds size limit");
  return {passed:left===right,expected,
    expectedDigest:await contentHash(new TextEncoder().encode(left)),
    observedDigest:await contentHash(new TextEncoder().encode(right))};
}
