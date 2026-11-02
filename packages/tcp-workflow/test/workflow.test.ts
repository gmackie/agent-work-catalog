import {describe,expect,it} from "vitest";
import {generateKeyPair,exportPKCS8,exportSPKI} from "jose";
import {createR2ArtifactCustody,type R2BucketLike} from "@awc/artifact-custody";
import {analyzeTcpCapture,tcpCaptureSha256} from "@awc/tcp-analysis";
import {makeTestPcap} from "@awc/modbus-pcap/testing";
import {verifyObservation,TCP_OBSERVATION_SCHEMA} from "@awc/attest-receipts";
import type {DispatchRecord} from "@awc/dispatch";
import {createTcpResultProcessor} from "../src/index.ts";

describe("TCP broker evidence and draft Attest observation",()=>{
  it("recomputes a real TCP report and stores verifiable buyer-scoped artifacts",async()=>{
    const stored=new Map<string,Uint8Array>();
    const bucket:R2BucketLike={
      put:async(key,bytes)=>{stored.set(key,Uint8Array.from(bytes));return {key};},
      get:async(key)=>{const bytes=stored.get(key);return bytes?{
        size:bytes.length,arrayBuffer:async()=>Uint8Array.from(bytes).buffer,
      }:null;},
    };
    const custody=createR2ArtifactCustody(bucket);
    const capture=makeTestPcap([
      {direction:"request",transactionId:5,functionCode:3,timestampMicros:1000},
      {direction:"response",transactionId:5,functionCode:3,timestampMicros:40000},
    ]);
    const report=await analyzeTcpCapture(capture),sha=await tcpCaptureSha256(capture);
    const keys=await generateKeyPair("EdDSA",{extractable:true});
    const signer={
      issuerId:"issuer:awc-test",keyId:"test-tcp-key",
      privateKeyPem:await exportPKCS8(keys.privateKey),
      publicKeyPem:await exportSPKI(keys.publicKey),
    };
    const record={
      workId:"work_tcp_1",buyerId:"buyerA",executorId:"trusted.tcp",
      quoteDigest:"a".repeat(64),request:{taskTypeId:"task:tcp-flow-evidence",
        inputs:[{name:"capture",kind:"inline",mediaType:"application/vnd.tcpdump.pcap",
          data:btoa(String.fromCharCode(...capture)),sha256:sha}]},
    } as unknown as DispatchRecord;
    const input={
      orderId:record.workId,summary:"Raw",producedAt:"2026-11-01T19:00:00Z",
      artifacts:[{name:"report.json",kind:"inline" as const,mediaType:"application/json",data:report}],
    };
    const processor=createTcpResultProcessor(custody,signer);
    const result=await processor.process(record,input);
    expect(result.artifacts).toHaveLength(3);
    expect(result.artifacts.every(x=>x.kind==="reference")).toBe(true);
    const json=await custody.readOutput("buyerA",record.workId,result.artifacts[0]!.reference!);
    expect((JSON.parse(new TextDecoder().decode(json)) as {coverage:{flowCount:number}}).coverage.flowCount).toBe(1);
    const jwt=await custody.readOutput("buyerA",record.workId,result.artifacts[2]!.reference!);
    const obs=await verifyObservation(new TextDecoder().decode(jwt),{
      issuerId:signer.issuerId,keyId:signer.keyId,publicKeyPem:signer.publicKeyPem,
      workId:record.workId,contractDigest:record.quoteDigest,schema:TCP_OBSERVATION_SCHEMA,
    });
    expect(obs.claims["awc.flow_count"]?.value).toBe("1");
    expect(obs.schema).toBe(TCP_OBSERVATION_SCHEMA);
    await expect(custody.readOutput("buyerB",record.workId,result.artifacts[0]!.reference!)).rejects.toThrow();
    const swapped={...report,coverage:{...report.coverage,flowCount:99}};
    await expect(processor.process(record,{...input,artifacts:[{...input.artifacts[0]!,data:swapped}]})).rejects.toThrow();
  });
});
