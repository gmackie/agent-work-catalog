import type { ArtifactCustody } from "@awc/artifact-custody";
import { buildTcpObservation, signObservation, verifyObservation,
  TCP_OBSERVATION_SCHEMA, type ReceiptSigner } from "@awc/attest-receipts";
import type { WorkResult } from "@awc/contracts";
import type { DispatchRecord, RemoteResultProcessor } from "@awc/dispatch";
import { evaluateTcpReport, tcpCaptureSha256, TCP_REPORT_SCHEMA } from "@awc/tcp-analysis";
import { PCAP_MEDIA_TYPE } from "@awc/modbus-pcap";

export class TcpWorkflowError extends Error {
  constructor(readonly code:"invalid"|"unavailable",message:string) {
    super(message);this.name="TcpWorkflowError";
  }
}
export interface TcpIssuer extends ReceiptSigner {
  readonly publicKeyPem:string;
}
/**
 * Broker-owned deterministic TCP checks and private artifact custody.
 * This repeats the same parser; it is NOT independent professional analysis.
 */
export function createTcpResultProcessor(
  custody:ArtifactCustody,issuer:TcpIssuer,
):RemoteResultProcessor {
  if(!issuer.issuerId||!issuer.keyId||!issuer.privateKeyPem||!issuer.publicKeyPem)
    throw new TcpWorkflowError("invalid","Pinned observation signer is required");
  return {
    process:async(record:DispatchRecord,untrusted:WorkResult):Promise<WorkResult>=>{
      if(record.request.taskTypeId!=="task:tcp-flow-evidence" ||
         record.request.inputs.length!==1 || untrusted.orderId!==record.workId ||
         untrusted.artifacts.length!==1) {
        throw new TcpWorkflowError("invalid","TCP result is not bound to its execution");
      }
      const input=record.request.inputs[0]!,artifact=untrusted.artifacts[0]!;
      if(input.kind!=="inline"||input.mediaType!==PCAP_MEDIA_TYPE||
         typeof input.data!=="string"||!input.sha256||
         artifact.kind!=="inline"||artifact.mediaType!=="application/json"||
         typeof artifact.data!=="object"||artifact.data===null ||
         !Number.isFinite(Date.parse(untrusted.producedAt))) {
        throw new TcpWorkflowError("invalid","Expected inline capture and structured TCP report");
      }
      let bytes:Uint8Array;
      try{bytes=Uint8Array.from(atob(input.data),char=>char.charCodeAt(0));}
      catch{throw new TcpWorkflowError("invalid","Malformed PCAP base64");}
      if(await tcpCaptureSha256(bytes)!==input.sha256)
        throw new TcpWorkflowError("invalid","PCAP input bytes differ from authorized capture");
      const verified=await evaluateTcpReport(bytes,artifact.data);
      if(!verified.passed||verified.expected.schemaVersion!==TCP_REPORT_SCHEMA)
        throw new TcpWorkflowError("invalid","Remote TCP report does not match broker recomputation");

      const reportBytes=new TextEncoder().encode(JSON.stringify(verified.expected));
      const report=await custody.putOutput(record.buyerId,record.workId,reportBytes,"application/json");
      const evaluation={
        schemaVersion:"awc.tcp.evaluation/v1",
        workOrderId:record.workId,
        quoteDigest:record.quoteDigest,
        status:"passed",
        captureSha256:verified.expected.captureSha256,
        reportSha256:report.sha256,
        checks:["pcap_sha256","flow_identity","sequence_range_evidence",
          "tcp_header_flags","bounded_report","capture_limitations"],
        limitations:verified.expected.limitations,
        checkedAt:untrusted.producedAt,
        policy:"awc.tcp.packet-consistency/v1",
        independentEvaluator:false,
      };
      const checkBytes=new TextEncoder().encode(JSON.stringify(evaluation));
      const check=await custody.putOutput(record.buyerId,record.workId,checkBytes,"application/json");
      const observed=await buildTcpObservation({
        issuerId:issuer.issuerId,subject:"executor:"+record.executorId,
        workId:record.workId,contractDigest:record.quoteDigest,
        captureDigest:verified.expected.captureSha256,
        reportDigest:report.sha256,evaluationDigest:check.sha256,
        findings:verified.expected.findings.length,
        packetFrames:verified.expected.coverage.totalFrames,
        flowCount:verified.expected.coverage.flowCount,
        tcpSegments:verified.expected.coverage.parsedTcpSegments,
        issuedAt:untrusted.producedAt,
      });
      const signed=await signObservation(observed,issuer);
      await verifyObservation(signed,{
        issuerId:issuer.issuerId,keyId:issuer.keyId,publicKeyPem:issuer.publicKeyPem,
        workId:record.workId,contractDigest:record.quoteDigest,schema:TCP_OBSERVATION_SCHEMA,
      });
      const proof=await custody.putOutput(record.buyerId,record.workId,
        new TextEncoder().encode(signed),"application/jose");
      return {
        ...untrusted,
        summary:"Observed "+verified.expected.coverage.parsedTcpSegments+" TCP segments across "+
          verified.expected.coverage.flowCount+" flows, with "+
          verified.expected.findings.length+" qualified findings; no unverified packet-loss or root-cause claims.",
        artifacts:[
          {name:"tcp-flow-evidence.json",kind:"reference",mediaType:"application/json",
            reference:report.ref,sha256:report.sha256},
          {name:"tcp-consistency-evaluation.json",kind:"reference",mediaType:"application/json",
            reference:check.ref,sha256:check.sha256},
          {name:"tcp-observation.jws",kind:"reference",mediaType:"application/jose",
            reference:proof.ref,sha256:proof.sha256},
        ],
      };
    }
  };
}
