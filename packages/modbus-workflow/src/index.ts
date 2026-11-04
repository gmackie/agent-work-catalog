import type { ArtifactCustody } from "@awc/artifact-custody";
import { buildObservation,signObservation,verifyObservation,
  type ReceiptSigner } from "@awc/attest-receipts";
import type { WorkResult } from "@awc/contracts";
import type { DispatchRecord, RemoteResultProcessor } from "@awc/dispatch";
import { analyzeClassicPcap,captureSha256,evaluatePcapReport,PCAP_MEDIA_TYPE } from "@awc/modbus-pcap";

export class ModbusWorkflowError extends Error{
  constructor(readonly code:"invalid"|"unavailable",message:string){super(message);this.name="ModbusWorkflowError";}
}
export interface ModbusReceiptConfig extends ReceiptSigner{
  /** The pinned public key is checked independently before accepting storage. */
  readonly publicKeyPem:string;
}
/** Reconstructs and independently evaluates evidence from the broker-approved capture. */
export function createModbusResultProcessor(
  custody:ArtifactCustody,
  signer:ModbusReceiptConfig,
):RemoteResultProcessor {
  if(!signer.issuerId||!signer.keyId||!signer.privateKeyPem||!signer.publicKeyPem)
    throw new ModbusWorkflowError("invalid","Pinned observation signing configuration required");
  return {
    process:async(record:DispatchRecord,result:WorkResult):Promise<WorkResult>=>{
      if(record.request.taskTypeId!=="task:modbus-pcap"||
         record.request.inputs.length!==1||
         result.orderId!==record.workId||
         result.artifacts.length!==1 ||
         !Number.isFinite(Date.parse(result.producedAt))) {
        throw new ModbusWorkflowError("invalid","Report result does not match the committed work");
      }
      const capture=record.request.inputs[0]!,output=result.artifacts[0]!;
      if(capture.kind!=="inline"||capture.mediaType!==PCAP_MEDIA_TYPE||
         typeof capture.data!=="string"||!capture.sha256||
         output.kind!=="inline"||output.mediaType!=="application/json"||
         typeof output.data!=="object"||output.data===null) {
        throw new ModbusWorkflowError("invalid","Report or capture representation invalid");
      }
      let bytes:Uint8Array;
      try{
        bytes=Uint8Array.from(atob(capture.data),c=>c.charCodeAt(0));
      }catch{throw new ModbusWorkflowError("invalid","Capture is not base64");}
      if(await captureSha256(bytes)!==capture.sha256)
        throw new ModbusWorkflowError("invalid","Capture bytes do not match signed input commitment");
      const evalResult=await evaluatePcapReport(bytes,output.data);
      if(!evalResult.passed)throw new ModbusWorkflowError("invalid",
        "Remote report differs from the recomputed deterministic packet evidence");
      // Stored JSON bytes are identical to the independently checked content.
      const reportBytes=new TextEncoder().encode(JSON.stringify(evalResult.report));
      const report=await custody.putOutput(record.buyerId,record.workId,reportBytes,"application/json");
      const evaluation={
        schemaVersion:"awc.modbus.evaluation/v1",
        status:"passed",
        policy:"awc.modbus.packet-consistency/v1",
        workOrderId:record.workId,
        contractDigest:record.quoteDigest,
        captureDigest:evalResult.report.captureSha256,
        reportDigest:report.sha256,
        passedChecks:evalResult.checks,
        limitations:evalResult.report.limitations,
        checkedAt:result.producedAt,
      };
      const evaluationBytes=new TextEncoder().encode(JSON.stringify(evaluation));
      const verified=await custody.putOutput(
        record.buyerId,record.workId,evaluationBytes,"application/json");
      const observation=await buildObservation({
        issuerId:signer.issuerId,subject:"executor:"+record.executorId,
        workId:record.workId,contractDigest:record.quoteDigest,
        captureDigest:evalResult.report.captureSha256,
        reportDigest:report.sha256,evaluationDigest:verified.sha256,
        findings:evalResult.report.findings.length,
        packetFrames:evalResult.report.coverage.totalFrames,
        issuedAt:result.producedAt,
      });
      const signed=await signObservation(observation,signer);
      await verifyObservation(signed,{
        issuerId:signer.issuerId,keyId:signer.keyId,
        publicKeyPem:signer.publicKeyPem,workId:record.workId,
        contractDigest:record.quoteDigest,
      });
      const receipt=await custody.putOutput(
        record.buyerId,record.workId,new TextEncoder().encode(signed),"application/jose");
      return {
        ...result,
        summary:"Observed "+evalResult.report.coverage.parsedAdus+" complete Modbus/TCP ADUs, "+
          evalResult.report.findings.length+" bounded findings. This is packet evidence, not a professional certification.",
        artifacts:[
          {name:"modbus-findings.json",kind:"reference",mediaType:"application/json",
            reference:report.ref,sha256:report.sha256},
          {name:"packet-evaluation.json",kind:"reference",mediaType:"application/json",
            reference:verified.ref,sha256:verified.sha256},
          {name:"attest-observation.jws",kind:"reference",mediaType:"application/jose",
            reference:receipt.ref,sha256:receipt.sha256},
        ],
      };
    },
  };
}
