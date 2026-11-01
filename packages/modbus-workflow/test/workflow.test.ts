import {describe,expect,it} from "vitest";
import {generateKeyPair,exportPKCS8,exportSPKI} from "jose";
import {createR2ArtifactCustody,type R2BucketLike} from "@awc/artifact-custody";
import {analyzeClassicPcap,captureSha256} from "@awc/modbus-pcap";
import {makeTestPcap} from "@awc/modbus-pcap/testing";
import {verifyObservation} from "@awc/attest-receipts";
import type {DispatchRecord} from "@awc/dispatch";
import {createModbusResultProcessor} from "../src/index.ts";

describe("Broker-owned packet evaluation, R2 custody and signed observation",()=>{
  it("recomputes actual report, stores private artifacts, and verifies issuer-signed observations",async()=>{
    const store=new Map<string,Uint8Array>();
    const bucket:R2BucketLike={
      put:async(key,b)=>{store.set(key,Uint8Array.from(b));return {key};},
      get:async(key)=>{const b=store.get(key);return b?{
        size:b.length,arrayBuffer:async()=>Uint8Array.from(b).buffer,
      }:null;},
    };
    const custody=createR2ArtifactCustody(bucket);
    const capture=makeTestPcap([{direction:"request",transactionId:9,functionCode:3},
      {direction:"response",transactionId:9,functionCode:3,exceptionCode:2,timestampMicros:10000}]);
    const parsed=await analyzeClassicPcap(capture),sha=await captureSha256(capture);
    const {privateKey,publicKey}=await generateKeyPair("EdDSA",{extractable:true});
    const signer={issuerId:"issuer:awc-pilot",keyId:"test-key",
      privateKeyPem:await exportPKCS8(privateKey),publicKeyPem:await exportSPKI(publicKey)};
    const record={
      workId:"work_packet_1",buyerId:"buyer1",executorId:"remote.packet",
      quoteDigest:"a".repeat(64),
      request:{taskTypeId:"task:modbus-pcap",inputs:[{
        name:"capture",kind:"inline",mediaType:"application/vnd.tcpdump.pcap",
        data:btoa(String.fromCharCode(...capture)),sha256:sha,
      }]},
    } as DispatchRecord;
    const result={orderId:record.workId,summary:"Raw result",producedAt:"2026-11-01T19:00:00Z",
      artifacts:[{kind:"inline" as const,name:"modbus-findings.json",mediaType:"application/json",data:parsed}]};
    const processor=createModbusResultProcessor(custody,signer);
    const output=await processor.process(record,result);
    expect(output.artifacts).toHaveLength(3);
    expect(output.artifacts.every(a=>a.kind==="reference")).toBe(true);
    const report=output.artifacts[0]!,jwsArtifact=output.artifacts[2]!;
    const bytes=await custody.readOutput(record.buyerId,record.workId,report.reference!);
    expect(JSON.parse(new TextDecoder().decode(bytes)).findings[0].kind).toBe("exception_response");
    const jws=new TextDecoder().decode(await custody.readOutput(record.buyerId,record.workId,jwsArtifact.reference!));
    const receipt=await verifyObservation(jws,{issuerId:signer.issuerId,
      keyId:signer.keyId,publicKeyPem:signer.publicKeyPem,
      workId:record.workId,contractDigest:record.quoteDigest});
    expect(receipt.claims["awc.consistency_checked"]?.value).toBe(true);
    await expect(custody.readOutput("otherBuyer",record.workId,report.reference!)).rejects.toThrow();
    const tampered={...result,artifacts:[{...result.artifacts[0]!,
      data:{...parsed,coverage:{...parsed.coverage,totalFrames:900}}}]};
    await expect(processor.process(record,tampered)).rejects.toThrow();
  });
});
