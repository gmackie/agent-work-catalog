/**
 * Bounded classic-PCAP Ethernet/IPv4/TCP Modbus diagnostics.
 * Inspect only visible, complete MBAP ADUs in individual TCP segments.
 * No TCP reassembly, IPv6, pcapng, TLS, fragmented IPv4 or inferred physical faults.
 */
export const ANALYZER_ID = "awc/modbus-pcap@0.1.0" as const;
export const PCAP_MEDIA_TYPE = "application/vnd.tcpdump.pcap" as const;
export const MAX_CAPTURE_BYTES = 48 * 1024;
const MAX_FRAMES = 500;
const MAX_TRANSACTIONS = 250;

export class CaptureError extends Error {
  readonly _tag = "CaptureError";
  constructor(readonly code:"unsupported"|"invalid"|"too_large",message:string) {
    super(message);this.name="CaptureError";
  }
}
export interface FrameEvidence {
  readonly frame:number;readonly timestampMicros:number;
  readonly src:string;readonly dst:string;
  readonly srcPort:number;readonly dstPort:number;
  readonly transactionId:number;readonly unitId:number;readonly functionCode:number;
  readonly exceptionCode?:number;
}
export interface Transaction {
  readonly transactionId:number;readonly unitId:number;readonly functionCode:number;
  readonly requestFrame:number;readonly responseFrame?:number;
  readonly elapsedMs?:number;readonly exceptionCode?:number;
}
export interface Finding {
  readonly kind:"exception_response"|"unanswered_observed"|"unmatched_response"|
    "function_mismatch"|"malformed_mbap"|"partial_tcp_segment";
  readonly confidence:"observed"|"limited_capture";
  readonly frameNumbers:readonly number[];
  readonly description:string;
  readonly exceptionCode?:number;
}
export interface PcapReport {
  readonly schemaVersion:"awc.modbus.pcap-report/v1";
  readonly analyzer:typeof ANALYZER_ID;
  readonly captureSha256:string;
  readonly coverage:{
    readonly totalFrames:number;readonly tcpSegments:number;
    readonly parsedAdus:number;readonly skippedFrames:number;
    readonly incompleteSegments:number;
  };
  readonly transactions:readonly Transaction[];
  readonly findings:readonly Finding[];
  readonly limitations:readonly string[];
}
export const LIMITATIONS = [
  "Only classic PCAP Ethernet / IPv4 / TCP on port 502 is supported.",
  "Packet-level parser: no TCP stream reassembly, retransmission handling, IPv4 fragment reconstruction, IPv6 or pcapng.",
  "Missing responses mean absent from this capture, not proven device timeout or connection failure.",
  "No TLS or Modbus Security decryption; register values are deliberately not included.",
] as const;
const u16=(bytes:Uint8Array,at:number)=>((bytes[at]??0)<<8)|(bytes[at+1]??0);
const ip=(bytes:Uint8Array,at:number)=>[0,1,2,3].map(i=>bytes[at+i]??0).join(".");
const hex=async(bytes:Uint8Array):Promise<string>=>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256",Uint8Array.from(bytes)))]
    .map(v=>v.toString(16).padStart(2,"0")).join("");
export const captureSha256=hex;
const roundMillis=(ms:number)=>Math.round(ms*1000)/1000;

export async function analyzeClassicPcap(raw:Uint8Array):Promise<PcapReport>{
  if(raw.byteLength>MAX_CAPTURE_BYTES)throw new CaptureError("too_large","Capture exceeds 48KiB pilot limit");
  if(raw.byteLength<24)throw new CaptureError("invalid","Incomplete global PCAP header");
  const magic=[...raw.slice(0,4)].map(v=>v.toString(16).padStart(2,"0")).join("");
  const settings:Record<string,{le:boolean;denominator:number}>={
    "d4c3b2a1":{le:true,denominator:1},
    "a1b2c3d4":{le:false,denominator:1},
    "4d3cb2a1":{le:true,denominator:1000},
    "a1b23c4d":{le:false,denominator:1000},
  };
  const format=settings[magic];
  if(!format)throw new CaptureError("unsupported","Only classic PCAP (not pcapng) supported");
  const view=new DataView(raw.buffer,raw.byteOffset,raw.byteLength);
  const get16=(offset:number)=>view.getUint16(offset,format.le);
  const get32=(offset:number)=>view.getUint32(offset,format.le);
  if(get16(4)!==2||get16(6)!==4)throw new CaptureError("unsupported","PCAP version is not 2.4");
  const snaplen=get32(16);
  const linktype=get32(20)&0xffff;
  if(linktype!==1)throw new CaptureError("unsupported","Only Ethernet LINKTYPE_ETHERNET=1 supported");
  if(snaplen<14||snaplen>65535)throw new CaptureError("invalid","Invalid capture snaplen");
  const captureDigest=await hex(raw);
  const requests=new Map<string,Array<FrameEvidence>>();
  const transactions:Transaction[]=[];
  const findings:Finding[]=[];
  let offset=24,frame=0,tcpSegments=0,parsedAdus=0,skippedFrames=0,incompleteSegments=0;
  const finding=(kind:Finding["kind"],confidence:Finding["confidence"],
    frames:number[],description:string,exceptionCode?:number)=>{
    if(findings.length>=MAX_TRANSACTIONS)throw new CaptureError("too_large","Too many diagnostics in capture");
    findings.push({kind,confidence,frameNumbers:frames,description,
      ...(exceptionCode===undefined?{}:{exceptionCode})});
  };
  while(offset<raw.byteLength){
    if(++frame>MAX_FRAMES)throw new CaptureError("too_large","Packet count exceeds pilot limit");
    if(raw.byteLength-offset<16)throw new CaptureError("invalid","Truncated PCAP packet record header");
    const seconds=get32(offset),partial=get32(offset+4),included=get32(offset+8),original=get32(offset+12);
    if(included>snaplen||included>original||raw.byteLength-offset-16<included||included===0)
      throw new CaptureError("invalid","Packet capture record length is invalid");
    offset+=16;
    const packet=raw.subarray(offset,offset+included);
    offset+=included;
    const timestampMicros=seconds*1_000_000+Math.round(partial/format.denominator);
    if((format.denominator===1 && partial>=1_000_000) ||
       (format.denominator===1000 && partial>=1_000_000_000))
      throw new CaptureError("invalid","Invalid PCAP subsecond timestamp");
    let eth=12;
    if(packet.length<14){skippedFrames++;continue;}
    let etherType=u16(packet,eth);
    let network=14;
    let tags=0;
    while([0x8100,0x88a8].includes(etherType)&&tags<2){
      if(packet.length<network+4)break;
      etherType=u16(packet,network+2);network+=4;tags++;
    }
    if(etherType!==0x0800){skippedFrames++;continue;}
    if(packet.length<network+20){skippedFrames++;continue;}
    const version=packet[network]!>>4,ihl=(packet[network]!&15)*4;
    const total=u16(packet,network+2);
    if(version!==4||ihl<20||packet.length<network+ihl||total<ihl){
      skippedFrames++;continue;
    }
    const flagsFrag=u16(packet,network+6);
    if((flagsFrag&0x3fff)!==0||packet[network+9]!==6) {skippedFrames++;continue;}
    const src=ip(packet,network+12),dst=ip(packet,network+16);
    const tcp=network+ihl;
    const ipEnd=Math.min(packet.length,network+total);
    if(ipEnd<tcp+20){skippedFrames++;continue;}
    const tcpLength=(packet[tcp+12]!>>4)*4;
    const srcPort=u16(packet,tcp),dstPort=u16(packet,tcp+2);
    if(tcpLength<20||tcp+tcpLength>ipEnd|| (srcPort!==502 && dstPort!==502)){
      skippedFrames++;continue;
    }
    const payload=packet.subarray(tcp+tcpLength,ipEnd);
    if(payload.length===0){skippedFrames++;continue;}
    tcpSegments++;
    const client=srcPort===502?dst:src,server=srcPort===502?src:dst;
    const clientPort=srcPort===502?dstPort:srcPort;
    const response=srcPort===502;
    let at=0;
    while(at<payload.length) {
      if(payload.length-at<8){
        incompleteSegments++;
        finding("partial_tcp_segment","limited_capture",[frame],
          "TCP payload ends before a complete MBAP header and function code");
        break;
      }
      const transactionId=u16(payload,at),protocol=u16(payload,at+2),
        mbapLen=u16(payload,at+4),unitId=payload[at+6]!,rawFunction=payload[at+7]!;
      if(protocol!==0||mbapLen<2||mbapLen>254){
        finding("malformed_mbap","observed",[frame],
          "MBAP header has invalid protocol identifier or length");
        break;
      }
      const aduSize=6+mbapLen;
      if(payload.length-at<aduSize){
        incompleteSegments++;
        finding("partial_tcp_segment","limited_capture",[frame],
          "Modbus ADU crosses a TCP segment; stream reassembly is not supported");
        break;
      }
      parsedAdus++;
      if(parsedAdus>MAX_TRANSACTIONS)throw new CaptureError("too_large","Too many Modbus ADUs");
      const functionCode=rawFunction&0x7f;
      const exceptionCode=(rawFunction&0x80) ? payload[at+8] : undefined;
      const current:FrameEvidence={frame,timestampMicros,src,dst,srcPort,dstPort,
        transactionId,unitId,functionCode,
        ...(exceptionCode===undefined?{}:{exceptionCode})};
      const key=[client,clientPort,server,unitId,transactionId].join("|");
      if(!response){
        const pending=requests.get(key)??[];
        pending.push(current);
        requests.set(key,pending);
      }else{
        const pending=requests.get(key)??[];
        const request=pending.shift();
        if(!request){
          finding("unmatched_response","limited_capture",[frame],
            "Response has no corresponding observed request in this capture");
        }else{
          const elapsedMs=roundMillis((timestampMicros-request.timestampMicros)/1000);
          const tx:Transaction={transactionId,unitId,functionCode:request.functionCode,
            requestFrame:request.frame,responseFrame:frame,
            ...(elapsedMs>=0?{elapsedMs}:{}),
            ...(exceptionCode===undefined?{}:{exceptionCode})};
          transactions.push(tx);
          if(request.functionCode!==functionCode)
            finding("function_mismatch","observed",[request.frame,frame],
              "Response function code does not match observed request");
          if(exceptionCode!==undefined)
            finding("exception_response","observed",[request.frame,frame],
              "Server returned a Modbus exception response",exceptionCode);
        }
      }
      at+=aduSize;
    }
  }
  for(const group of requests.values()){
    for(const pending of group){
      transactions.push({transactionId:pending.transactionId,unitId:pending.unitId,
        functionCode:pending.functionCode,requestFrame:pending.frame});
      finding("unanswered_observed","limited_capture",[pending.frame],
        "No matching response observed in the supplied capture; not proof of a timeout");
    }
  }
  transactions.sort((a,b)=>a.requestFrame-b.requestFrame||a.transactionId-b.transactionId);
  findings.sort((a,b)=>a.frameNumbers[0]!-b.frameNumbers[0]!);
  return {
    schemaVersion:"awc.modbus.pcap-report/v1",analyzer:ANALYZER_ID,captureSha256:captureDigest,
    coverage:{totalFrames:frame,tcpSegments,parsedAdus,skippedFrames,incompleteSegments},
    transactions,findings,limitations:[...LIMITATIONS],
  };
}

/** The broker re-analyzes exact committed bytes; this is consistency evaluation,
 * not independent validation of professional expertise or packet-capture completeness. */
export async function evaluatePcapReport(input:Uint8Array,untrusted:unknown):Promise<{
  readonly passed:boolean;readonly checks:readonly string[];
  readonly expectedDigest:string;readonly observedDigest:string;
  readonly report:PcapReport;
}> {
  const expected=await analyzeClassicPcap(input);
  const observed=JSON.stringify(untrusted);
  if(observed.length>120_000)throw new CaptureError("too_large","Reported analysis too large");
  const expectedJson=JSON.stringify(expected);
  return {passed:observed===expectedJson,
    checks:["pcap_sha256","packet_metadata","transaction_pairing",
      "exception_codes","bounded_limitations","report_schema"],
    expectedDigest:await hex(new TextEncoder().encode(expectedJson)),
    observedDigest:await hex(new TextEncoder().encode(observed)),
    report:expected};
}
