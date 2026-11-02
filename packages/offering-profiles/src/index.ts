/**
 * Commercial product taxonomy; none of these prices are verified real-market prices.
 * "pilot-test-only" permits a sandbox quote only; "planned" cannot be purchased.
 */
export type Readiness="pilot-test-only"|"planned";
export type PricingModel=
  | {readonly kind:"fixed-illustrative";readonly currency:"USD";readonly minorUnits:string}
  | {readonly kind:"quoted";readonly currency:"USD";readonly startingMinorUnits:string}
  | {readonly kind:"subscription-illustrative";readonly currency:"USD";readonly monthlyMinorUnits:string};
export interface ServiceProfile {
  readonly id:string; readonly level:"extract"|"protocol"|"investigate"|"assure";
  readonly name:string; readonly outcome:string; readonly readiness:Readiness;
  readonly taskTypeId:string; readonly inputContract:readonly string[];
  readonly outputContract:readonly string[]; readonly requiredEvidence:readonly string[];
  readonly disallowedClaims:readonly string[];
  readonly evaluationPolicy:string; readonly pricing:PricingModel;
  readonly purchaseMode:"direct-fixed"|"request-quote"|"subscription";
  readonly dependencies:readonly string[];
}
const commonWarnings=[
  "No proof of network packet loss or the root cause of a PLC outage from a partial PCAP",
  "No secrets, device credentials, or live control-system actions",
  "No independent professional certification or signed Attest authority proof",
];
export const tcpServiceProfiles:readonly ServiceProfile[]=[
  {
    id:"tcp.packet-evidence.v1",level:"extract",name:"TCP Packet Evidence Report",
    outcome:"Bounded packet facts: flows, SYN/SYN-ACK delay, RST, zero window and ambiguous repeated/gap ranges",
    readiness:"pilot-test-only",taskTypeId:"task:tcp-pcap",
    inputContract:["public classic-PCAP Ethernet/IPv4/TCP <=48KiB"],
    outputContract:["awc.tcp.packet-evidence/v1","application/json","frame references"],
    requiredEvidence:["input SHA-256","frame-level TCP fields","broker deterministic recomputation",
      "report SHA-256","broker signed observation (test issuer)"],
    disallowedClaims:commonWarnings,evaluationPolicy:"awc.tcp.deterministic-consistency/v1",
    pricing:{kind:"fixed-illustrative",currency:"USD",minorUnits:"900"},
    purchaseMode:"direct-fixed",dependencies:["R2 input custody","separate human data disclosure consent",
      "pinned remote parser","sandbox/test funding"],
  },
  {
    id:"tcp.handshake-reset.v1",level:"extract",name:"TCP Handshake and Reset Triage",
    outcome:"Explain observed handshake attempts, response times, resets, and absent responses with context",
    readiness:"planned",taskTypeId:"task:tcp-handshake",
    inputContract:["classic PCAP","capture point metadata","SYN context"],
    outputContract:["handshake findings JSON","timeline with packet references"],
    requiredEvidence:["three-way handshake state machine","SYN retransmission normalization",
      "independent TShark comparison"],disallowedClaims:commonWarnings,
    evaluationPolicy:"awc.tcp.handshake/v1",
    pricing:{kind:"fixed-illustrative",currency:"USD",minorUnits:"1500"},
    purchaseMode:"request-quote",dependencies:["TCP stateful flow tracker","independent packet oracle"],
  },
  {
    id:"tcp.sequence-window.v1",level:"protocol",name:"TCP Sequence and Window Analysis",
    outcome:"Analyze retransmission candidates, SACK, zero windows, sequence gaps and receiver constraints",
    readiness:"planned",taskTypeId:"task:tcp-sequence",
    inputContract:["PCAP with TCP handshakes or explicit midstream caveat"],
    outputContract:["window/sequence evidence JSON","ambiguity markers","packet-linked report"],
    requiredEvidence:["TCP 32-bit wrap tests","SACK/window-scale negotiation",
      "TShark differential corpus","capture loss caveat"],
    disallowedClaims:commonWarnings,evaluationPolicy:"awc.tcp.sequence/v1",
    pricing:{kind:"fixed-illustrative",currency:"USD",minorUnits:"2500"},
    purchaseMode:"request-quote",dependencies:["TCP retransmission and out-of-order disambiguation",
      "SACK + RFC 7323 handling","stream accounting"],
  },
  {
    id:"ot.modbus-transaction.v1",level:"protocol",name:"Modbus/TCP Transaction Evidence",
    outcome:"Correlate MBAP transaction IDs, response timings, exceptions and unmatched requests",
    readiness:"pilot-test-only",taskTypeId:"task:modbus-pcap",
    inputContract:["public classic PCAP <=48KiB"],outputContract:["awc.modbus.pcap-report/v1",
      "application/json","packet evidence references"],
    requiredEvidence:["PCAP digest","MBAP transaction correlation","broker parser consistency check",
      "provisional signed observation"],
    disallowedClaims:commonWarnings,evaluationPolicy:"awc.modbus.packet-consistency/v1",
    pricing:{kind:"fixed-illustrative",currency:"USD",minorUnits:"3500"},
    purchaseMode:"direct-fixed",dependencies:["modbus-pcap package","pinned remote analyzer","private R2"],
  },
  {
    id:"tcp.capture-diff.v1",level:"protocol",name:"Before/After Capture Comparison",
    outcome:"Compare connection behavior and observed regressions across two capture windows",
    readiness:"planned",taskTypeId:"task:tcp-diff",
    inputContract:["two capture windows","same sensor placement and sampling context"],
    outputContract:["structured delta report","evidence cross-references","capture coverage matrix"],
    requiredEvidence:["time alignment","endpoint normalization","confidence calibration"],
    disallowedClaims:commonWarnings,evaluationPolicy:"awc.tcp.capture-diff/v1",
    pricing:{kind:"fixed-illustrative",currency:"USD",minorUnits:"4900"},
    purchaseMode:"request-quote",dependencies:["multi-artifact contract","capture metadata and matching"],
  },
  {
    id:"ot.communication-triage.v1",level:"investigate",name:"OT Communications Incident Triage",
    outcome:"Rank competing hypotheses using PLC logs, PCAP evidence, HMI trends and approved context",
    readiness:"planned",taskTypeId:"task:ot-incident",
    inputContract:["PCAP","device topology","PLC/HMI event logs"],
    outputContract:["hypotheses/evidence table","confidence and alternatives","next diagnostic steps"],
    requiredEvidence:["multiple independent inputs","human expert review","false-positive tests"],
    disallowedClaims:commonWarnings,evaluationPolicy:"awc.ot.incident/v1",
    pricing:{kind:"quoted",currency:"USD",startingMinorUnits:"9000"},
    purchaseMode:"request-quote",dependencies:["multi-modal artifact ingestion","specialist tools",
      "reviewer credentials","time-aligned telemetry"],
  },
  {
    id:"tcp.enterprise-incident.v1",level:"investigate",name:"Enterprise TCP Incident Investigation",
    outcome:"Investigate client/server connectivity using network traces, endpoint data and service logs",
    readiness:"planned",taskTypeId:"task:tcp-incident",
    inputContract:["redacted PCAPs","service metrics","endpoint logs","explicit network scope"],
    outputContract:["incident timeline","evidence-linked hypotheses","reproduction checklist"],
    requiredEvidence:["cross-source chronology","human escalation","tool provenance"],
    disallowedClaims:commonWarnings,evaluationPolicy:"awc.tcp.investigation/v1",
    pricing:{kind:"quoted",currency:"USD",startingMinorUnits:"14900"},
    purchaseMode:"request-quote",dependencies:["correlation engine","protected telemetry",
      "support for large captures"],
  },
  {
    id:"ot.baseline-monitor.v1",level:"assure",name:"Continuous OT Traffic Baseline",
    outcome:"Produce reviewed periodic drift reports from approved passive network monitors",
    readiness:"planned",taskTypeId:"task:ot-baseline",
    inputContract:["approved passive sensor feeds","asset inventory","historical baseline"],
    outputContract:["daily drift digest","anomaly evidence references","retained audit events"],
    requiredEvidence:["baseline drift calibration","false-alert measurement",
      "authorized sensor identity","retention controls"],
    disallowedClaims:commonWarnings,evaluationPolicy:"awc.ot.baseline/v1",
    pricing:{kind:"subscription-illustrative",currency:"USD",monthlyMinorUnits:"29900"},
    purchaseMode:"subscription",dependencies:["long-running ingestion","sensor trust","retention and alerting",
      "operational response playbook"],
  },
  {
    id:"ot.assurance-reviewed.v1",level:"assure",name:"Independently Reviewed Protocol Assurance",
    outcome:"Prepare an evidence-backed report with an independently authorized expert evaluation",
    readiness:"planned",taskTypeId:"task:ot-assurance",
    inputContract:["contracted capture set","scope","reviewer access","complete evidence chain"],
    outputContract:["signed findings","reviewer evaluation","attestation presentation"],
    requiredEvidence:["recognized issuer scope","independent human reviewer",
      "status/revocation checks","documented methodology"],
    disallowedClaims:commonWarnings,evaluationPolicy:"attest.marketplace/v1-reviewer",
    pricing:{kind:"quoted",currency:"USD",startingMinorUnits:"49900"},
    purchaseMode:"request-quote",dependencies:["Attest issue #9","human reviewer marketplace",
      "audit logging","dispute/acceptance and professional terms"],
  },
];
export function listTcpServiceProfiles(){
  return tcpServiceProfiles.map(x=>({...x,dependencies:[...x.dependencies]}));
}
export function executableTcpPilot(id:string){
  return tcpServiceProfiles.find(x=>x.id===id&&x.readiness==="pilot-test-only")??null;
}
