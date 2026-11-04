import {describe,expect,it} from "vitest";
import {generateKeyPair,exportPKCS8,exportSPKI} from "jose";
import {createR2ArtifactCustody,type R2BucketLike} from "@awc/artifact-custody";
import {analyzeTcpPcap} from "@awc/tcp-pcap";
import {makeTestPcap} from "@awc/modbus-pcap/testing";
import {verifyTcpEvidenceReceipt} from "@awc/attest-receipts/tcp";
import {createTcpResultProcessor} from "../src/index.ts";
import type {DispatchRecord} from "@awc/dispatch";

const fixture=makeTestPcap([{direction:"request",transactionId:10,functionCode:3},
 {direction:"response",transactionId:10,functionCode:3,exceptionCode:2,timestampMicros:35000}]);
const bucket=():R2BucketLike=>{
  const items=new Map<string,Uint8Array>();
  return {
    put:async(key,bytes)=>{items.set(key,Uint8Array.from(bytes));return {key};},
    get:async(key)=>{const b=items.get(key);return b?{size:b.length,arrayBuffer:async()=>Uint8Array.from(b).buffer}:null;},
  };
};
describe("broker-recomputed TCP report and private evidence",()=>{
 it("rejects forged output; stores digest-bound findings, assessment and broker JWS",async()=>{
  const custody=createR2ArtifactCustody(bucket());
  const {privateKey,publicKey}=await generateKeyPair("EdDSA",{extractable:true});
  const signer={issuerId:"broker:tcp-pilot",keyId:"dev-key",
    privateKeyPem:await exportPKCS8(privateKey),publicKeyPem:await exportSPKI(publicKey)};
  const report=await analyzeTcpPcap(fixture);
  const record={
    workId:"work_tcp_test",buyerId:"buyer1",executorId:"worker:tcp",
    quoteDigest:"a".repeat(64),
    request:{taskTypeId:"task:tcp-pcap",inputs:[{
      name:"capture",kind:"inline",mediaType:"application/vnd.tcpdump.pcap",
      data:btoa(String.fromCharCode(...fixture)),sha256:report.captureSha256,
    }]},
  } as unknown as DispatchRecord;
  const output={orderId:record.workId,summary:"Raw report",producedAt:"2026-11-02T08:00:00Z",
    artifacts:[{name:"tcp.json",kind:"inline" as const,mediaType:"application/json",data:report}]};
  const processor=createTcpResultProcessor(custody,signer);
  const result=await processor.process(record,output);
  expect(result.artifacts).toHaveLength(3);
  expect(result.artifacts.every(x=>x.kind==="reference")).toBe(true);
  const b=await custody.readOutput(record.buyerId,record.workId,result.artifacts[0]!.reference!);
  expect((JSON.parse(new TextDecoder().decode(b)) as {coverage:{tcpFrames:number}}).coverage.tcpFrames).toBe(2);
  const jws=new TextDecoder().decode(await custody.readOutput(record.buyerId,record.workId,result.artifacts[2]!.reference!));
  expect((await verifyTcpEvidenceReceipt(jws,{
    issuerId:signer.issuerId,keyId:signer.keyId,publicKeyPem:signer.publicKeyPem,
    workOrderId:record.workId,contractDigest:record.quoteDigest,
  })).assurance).toBe("broker-consistency-only");
  await expect(custody.readOutput("buyer2",record.workId,result.artifacts[0]!.reference!)).rejects.toThrow();
  const forged={...output,artifacts:[{...output.artifacts[0]!,data:{
    ...report,coverage:{...report.coverage,tcpFrames:999},
  }}]};
  await expect(processor.process(record,forged)).rejects.toThrow();
 });
});
