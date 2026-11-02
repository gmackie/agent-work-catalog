import {describe,expect,it} from "vitest";
import {generateKeyPair,exportPKCS8,exportSPKI} from "jose";
import {makeTcpEvidenceReceipt,signTcpEvidenceReceipt,verifyTcpEvidenceReceipt} from "../src/tcp.ts";
describe("provisional broker TCP receipt",()=>{
  it("verifies exact work and contract with a pinned key; rejects substitution",async()=>{
    const pair=await generateKeyPair("EdDSA",{extractable:true});
    const signer={issuerId:"broker:pilot",keyId:"test-key",privateKeyPem:await exportPKCS8(pair.privateKey),
      publicKeyPem:await exportSPKI(pair.publicKey)};
    const receipt=await makeTcpEvidenceReceipt({issuerId:signer.issuerId,subject:"executor:pilot",
      workOrderId:"work-1",contractDigest:"a".repeat(64),inputDigest:"b".repeat(64),
      reportDigest:"c".repeat(64),evaluationDigest:"d".repeat(64),
      packetFrames:5,flowCount:2,observations:3,issuedAt:"2026-11-02T05:00:00Z"});
    const jws=await signTcpEvidenceReceipt(receipt,signer);
    const expected={issuerId:signer.issuerId,keyId:signer.keyId,
      publicKeyPem:signer.publicKeyPem,workOrderId:"work-1",contractDigest:"a".repeat(64)};
    expect((await verifyTcpEvidenceReceipt(jws,expected)).assurance).toBe("broker-consistency-only");
    await expect(verifyTcpEvidenceReceipt(jws,{...expected,workOrderId:"another"})).rejects.toThrow();
    const parts=jws.split(".");parts[1]=parts[1]!.slice(0,-4)+"AAAA";
    await expect(verifyTcpEvidenceReceipt(parts.join("."),expected)).rejects.toThrow();
  });
});
