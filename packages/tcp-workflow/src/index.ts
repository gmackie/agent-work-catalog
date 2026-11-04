import type { ArtifactCustody } from "@awc/artifact-custody";
import type { WorkResult } from "@awc/contracts";
import type { DispatchRecord,RemoteResultProcessor } from "@awc/dispatch";
import { analyzeTcpPcap,evaluateTcpReport,PCAP_MEDIA_TYPE } from "@awc/tcp-pcap";
import {
  makeTcpEvidenceReceipt,signTcpEvidenceReceipt,verifyTcpEvidenceReceipt,
  type TcpReceiptSigner,
} from "@awc/attest-receipts/tcp";
export class TcpWorkflowError extends Error{
  readonly _tag="TcpWorkflowError";
  constructor(message:string){super(message);this.name="TcpWorkflowError";}
}
/** Never trust the remote report alone; recompute on exact committed capture bytes. */
export function createTcpResultProcessor(
  custody:ArtifactCustody,signer:TcpReceiptSigner,
):RemoteResultProcessor {
  if(!signer.issuerId||!signer.keyId||!signer.privateKeyPem||!signer.publicKeyPem)
    throw new TcpWorkflowError("Pinned broker evidence key is required");
  return { process:async(record:DispatchRecord,result:WorkResult):Promise<WorkResult>=>{
    if(record.request.taskTypeId!=="task:tcp-pcap"||record.request.inputs.length!==1||
       result.orderId!==record.workId||result.artifacts.length!==1 ||
       !Number.isFinite(Date.parse(result.producedAt)))
      throw new TcpWorkflowError("TCP output is not bound to the work agreement");
    const input=record.request.inputs[0]!,artifact=result.artifacts[0]!;
    if(input.kind!=="inline"||input.mediaType!==PCAP_MEDIA_TYPE||
       typeof input.data!=="string"||!/^[a-f0-9]{64}$/.test(input.sha256??"")||
       artifact.kind!=="inline"||artifact.mediaType!=="application/json"||
       !artifact.data||typeof artifact.data!=="object")
      throw new TcpWorkflowError("Invalid TCP input or evidence payload");
    let bytes:Uint8Array;
    try { bytes=Uint8Array.from(atob(input.data),c=>c.charCodeAt(0)); }
    catch {throw new TcpWorkflowError("Invalid encoded TCP input");}
    const original=await analyzeTcpPcap(bytes);
    if(original.captureSha256!==input.sha256)
      throw new TcpWorkflowError("Capture changed after authorization");
    const check=await evaluateTcpReport(bytes,artifact.data);
    if(!check.passed)
      throw new TcpWorkflowError("Remote TCP report differs from bounded broker recomputation");
    const report=await custody.putOutput(record.buyerId,record.workId,
      new TextEncoder().encode(JSON.stringify(check.report)),"application/json");
    const assessment={
      schemaVersion:"awc.tcp.evaluation/v1",status:"passed",
      policy:"awc.tcp.deterministic-consistency/v1",
      workOrderId:record.workId,contractDigest:record.quoteDigest,
      analyzer:original.analyzer,inputDigest:original.captureSha256,
      reportDigest:report.sha256,checks:[...check.checks],
      limitations:[...original.limitations],checkedAt:result.producedAt,
    };
    const evalFile=await custody.putOutput(record.buyerId,record.workId,
      new TextEncoder().encode(JSON.stringify(assessment)),"application/json");
    const observation=await makeTcpEvidenceReceipt({
      issuerId:signer.issuerId,subject:"executor:"+record.executorId,
      workOrderId:record.workId,contractDigest:record.quoteDigest,
      inputDigest:original.captureSha256,reportDigest:report.sha256,
      evaluationDigest:evalFile.sha256,
      packetFrames:original.coverage.totalFrames,
      flowCount:original.flows.length,observations:original.observations.length,
      issuedAt:result.producedAt,
    });
    const signed=await signTcpEvidenceReceipt(observation,signer);
    await verifyTcpEvidenceReceipt(signed,{
      issuerId:signer.issuerId,keyId:signer.keyId,publicKeyPem:signer.publicKeyPem,
      workOrderId:record.workId,contractDigest:record.quoteDigest,
    });
    const receipt=await custody.putOutput(record.buyerId,record.workId,
      new TextEncoder().encode(signed),"application/jose");
    return {...result,
      summary:"Observed "+original.flows.length+" TCP flows and "+
        original.observations.length+" bounded packet observations. No root cause certified.",
      artifacts:[
        {name:"tcp-packet-evidence.json",kind:"reference",mediaType:"application/json",
          reference:report.ref,sha256:report.sha256},
        {name:"tcp-evaluation.json",kind:"reference",mediaType:"application/json",
          reference:evalFile.ref,sha256:evalFile.sha256},
        {name:"tcp-observation.jws",kind:"reference",mediaType:"application/jose",
          reference:receipt.ref,sha256:receipt.sha256},
      ],
    };
  }};
}
