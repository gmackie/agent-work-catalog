import { describe,expect,it } from "vitest";
import { createLocalJWKSet,exportJWK,generateKeyPair,SignJWT } from "jose";
import { verifyPdpBearer } from "../src/index.ts";
import type { PdpAuthConfig } from "../src/index.ts";
const config:PdpAuthConfig={
 issuer:"https://issuer.example",audience:"https://pdp.example",
 jwksUrl:"https://issuer.example/jwks",allowedClientIds:["awc-mcp-pep"],
 requiredScope:"awc:pdp:evaluate",
};
async function credentials(extra:Record<string,unknown>={}){
 const {publicKey,privateKey}=await generateKeyPair("RS256");
 const jwk=await exportJWK(publicKey);
 jwk.kid="trusted-key";
 const signed=new SignJWT({
  awc_tenant_id:"tenant:a",scope:"awc:pdp:evaluate",
  azp:"awc-mcp-pep",...extra,
 }).setProtectedHeader({alg:"RS256",kid:"trusted-key"})
  .setIssuer(config.issuer).setAudience(config.audience)
  .setSubject("agent:manager")
  .setIssuedAt().setExpirationTime("2m");
 return {token:await signed.sign(privateKey),keys:createLocalJWKSet({keys:[jwk]})};
}
describe("PDP-only OIDC verification",()=>{
 it("requires independent PDP audience and authenticated tenant/client/scope",async()=>{
  const {token,keys}=await credentials();
  const caller=await verifyPdpBearer("Bearer "+token,config,keys);
  expect(caller).toMatchObject({tenantId:"tenant:a",subjectId:"agent:manager",clientId:"awc-mcp-pep"});
  expect(caller.scopes).toContain("awc:pdp:evaluate");
  await expect(verifyPdpBearer("Bearer "+token,{...config,audience:"https://mcp.example"},keys)).rejects.toThrow();
 });
 it("rejects missing tenant, wrong client, missing scope, no token, and unsigned credentials",async()=>{
  const noTenant=await credentials({awc_tenant_id:null});
  await expect(verifyPdpBearer("Bearer "+noTenant.token,config,noTenant.keys)).rejects.toThrow();
  const different=await credentials({azp:"untrusted-client"});
  await expect(verifyPdpBearer("Bearer "+different.token,config,different.keys)).rejects.toThrow();
  const unscoped=await credentials({scope:"catalog:read"});
  await expect(verifyPdpBearer("Bearer "+unscoped.token,config,unscoped.keys)).rejects.toThrow();
  await expect(verifyPdpBearer(null,config,noTenant.keys)).rejects.toThrow();
  const first=await credentials();
  const second=await credentials();
  await expect(verifyPdpBearer("Bearer "+first.token,config,second.keys)).rejects.toThrow();
 });
});
