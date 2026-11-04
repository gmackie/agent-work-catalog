import { App } from "@modelcontextprotocol/ext-apps";

type Observation={kind:string;confidence:string;frames:readonly number[];description:string;flowId?:string};
type Flow={id:string;endpointA:string;endpointB:string;packets:number;payloadBytesObserved:number;
  handshakeSynToSynAckMs?:number;rstPackets:number;zeroWindowAdvertisements:number;
  duplicateRanges:number;overlappingRanges:number;observedGaps:number};
type Segment={frame:number;source:string;destination:string;sourcePort:number;destinationPort:number;
  sequence:number;acknowledgment:number;syn:boolean;ack:boolean;rst:boolean;fin:boolean;
  advertisedWindow:number;payloadBytes:number};
type Report={schemaVersion:string;analyzer:string;captureSha256:string;
  coverage:{totalFrames:number;tcpFrames:number;skippedFrames:number;truncatedFrames:number;flows:number};
  flows:readonly Flow[];segments:readonly Segment[];observations:readonly Observation[];limitations:readonly string[]};
type Artifact={ref:string;mediaType:string;integrityVerified:boolean;value?:unknown};
const app=new App({name:"AWC TCP Evidence Inspector",version:"0.1.0"});
const node=(selector:string)=>document.querySelector<HTMLElement>(selector)!;
const assurance=node("#assurance");
const safe=(x:unknown)=>typeof x==="string"?x:String(x??"");
function table(headers:string[],rows:readonly (readonly string[])[]):HTMLElement{
  const t=document.createElement("table"),thead=document.createElement("thead"),tr=document.createElement("tr");
  for(const title of headers){const th=document.createElement("th");th.textContent=title;tr.append(th);}
  thead.append(tr);t.append(thead);
  const body=document.createElement("tbody");
  for(const row of rows){const line=document.createElement("tr");
    for(const value of row){const td=document.createElement("td");td.textContent=value;line.append(td);}
    body.append(line);
  }
  t.append(body);return t;
}
function metric(label:string,value:string){
  const div=document.createElement("div");div.className="metric";
  const strong=document.createElement("strong");strong.textContent=value;
  const small=document.createElement("small");small.textContent=label;
  div.append(strong,small);node("#metrics").append(div);
}
function render(payload:Artifact){
  const data=payload.value;
  if(!payload.integrityVerified || payload.mediaType!=="application/json" || !data ||
     typeof data!=="object"||Array.isArray(data)||
     (data as Report).schemaVersion!=="awc.tcp.packet-evidence/v1"){
    assurance.textContent="This App displays only integrity-checked TCP packet-evidence reports. It cannot verify other artifacts here.";
    return;
  }
  const report=data as Report;
  if(!Array.isArray(report.flows)||!Array.isArray(report.segments)||
     !Array.isArray(report.observations)||!Array.isArray(report.limitations))return;
  assurance.textContent="R2 content digest verified by AWC. Packet findings remain evidence, not independently certified professional diagnoses.";
  node("#metrics").replaceChildren();
  metric("TCP frames",safe(report.coverage.tcpFrames));
  metric("Observed flows",safe(report.flows.length));
  metric("Observations",safe(report.observations.length));
  const flowRows=report.flows.map(f=>[
    safe(f.id),safe(f.endpointA)+" ⇄ "+safe(f.endpointB),
    safe(f.packets),safe(f.handshakeSynToSynAckMs??"not observed"),
    safe(f.rstPackets),safe(f.zeroWindowAdvertisements),
    safe(f.duplicateRanges+f.overlappingRanges+f.observedGaps)
  ]);
  const flows=node("#flows");flows.replaceChildren(table(
    ["Flow","Endpoints","Packets","SYN→SYN/ACK ms","RST","Zero window","Range warnings"],flowRows));
  const observations=node("#observations");observations.replaceChildren();
  const items=document.createElement("ul");
  for(const entry of report.observations){
    const li=document.createElement("li");
    li.textContent=safe(entry.kind)+" · frames "+(entry.frames??[]).join(", ")+
      " · "+safe(entry.confidence)+" — "+safe(entry.description);
    items.append(li);
  }
  if(items.childElementCount===0){
    const p=document.createElement("p");p.textContent="No observations emitted for these captured frames.";
    observations.append(p);
  }else observations.append(items);
  const segmentRows=report.segments.slice(0,500).map(s=>[
    safe(s.frame),safe(s.source)+":"+safe(s.sourcePort),
    safe(s.destination)+":"+safe(s.destinationPort),
    safe(s.sequence),safe(s.acknowledgment),safe(s.advertisedWindow),
    safe(s.payloadBytes),[s.syn?"SYN":"",s.ack?"ACK":"",s.rst?"RST":"",s.fin?"FIN":""].filter(Boolean).join("/")
  ]);
  node("#segments").replaceChildren(table(
    ["Frame","Source","Destination","SEQ","ACK","Window","Bytes","Flags"],segmentRows));
  const list=node("#limitations");list.replaceChildren();
  for(const limit of report.limitations){const li=document.createElement("li");li.textContent=safe(limit);list.append(li);}
  node("#commitment").textContent="Input SHA-256: "+safe(report.captureSha256)+
    " · Parser: "+safe(report.analyzer);
}
app.ontoolresult=(result)=>{
  const payload=result.structuredContent as Artifact|undefined;
  if(payload?.ref)render(payload);
};
void app.connect().catch(()=>{
  assurance.textContent="This view needs a compatible MCP Apps host and an authorized report-reading tool.";
});
