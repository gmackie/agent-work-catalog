import {describe,expect,it} from "vitest";
import {exportPKCS8,exportSPKI,generateKeyPair} from "jose";
import {buildObservation,signObservation,verifyObservation} from "../src/index.ts";
describe("Attest-shaped signed observation (provisional)",()=>{
 it("signs a narrowly attributed observation and rejects tampering or wrong authority",async()=>{
  const {privateKey,publicKey}=await generateKeyPair("EdDSA",{extractable:true});
  const privateKeyPem=await exportPKCS8(privateKey),publicKeyPem=await exportSPKI(publicKey);
  const observation=await buildObservation({
    issuerId:"issuer:awc-pilot",subject:"executor:test",
    workId:"work_test",contractDigest:"a".repeat(64),captureDigest:"b".repeat(64),
    reportDigest:"c".repeat(64),evaluationDigest:"d".repeat(64),
    findings:2,packetFrames:3,issuedAt:"2026-11-01T19:00:00Z",
  });
  const signed=await signObservation(observation,{issuerId:"issuer:awc-pilot",keyId:"pilot-key",
    privateKeyPem});
  expect((await verifyObservation(signed,{issuerId:"issuer:awc-pilot",keyId:"pilot-key",
    publicKeyPem,workId:"work_test",contractDigest:"a".repeat(64)})).claims["awc.packet_frames"]?.value).toBe("3");
  await expect(verifyObservation(signed,{issuerId:"issuer:awc-pilot",keyId:"pilot-key",
    publicKeyPem,workId:"another_work",contractDigest:"a".repeat(64)})).rejects.toThrow();
  const parts=signed.split(".");
  parts[1]=parts[1]!.slice(0,-3)+"ABC";
  await expect(verifyObservation(parts.join("."),{issuerId:"issuer:awc-pilot",keyId:"pilot-key",
    publicKeyPem,workId:"work_test",contractDigest:"a".repeat(64)})).rejects.toThrow();
 });
});
