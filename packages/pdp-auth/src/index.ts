import { createRemoteJWKSet, jwtVerify } from "jose";
import type { JWTPayload } from "jose";
import type { TrustedRegistryCaller } from "@awc/mandate-registry";

/** Strong separation of PDP audience from MCP agent and human approval audiences. */
export interface PdpAuthConfig {
  readonly issuer:string;
  readonly audience:string;
  readonly jwksUrl:string;
  readonly allowedClientIds:readonly string[];
  readonly requiredScope:string;
}
export interface AuthenticatedPdpCaller extends TrustedRegistryCaller {
  readonly scopes:readonly string[];
}
export class PdpAuthenticationError extends Error {
  readonly _tag="PdpAuthenticationError";
  constructor(readonly code:"unauthorized"|"configuration_error",message:string){
    super(message);this.name="PdpAuthenticationError";
  }
}
const jwksCache=new Map<string,ReturnType<typeof createRemoteJWKSet>>();
const cachedKeys=(url:string)=>{
  let k=jwksCache.get(url);
  if(!k){k=createRemoteJWKSet(new URL(url));jwksCache.set(url,k);}
  return k;
};
const bounded=(x:unknown):x is string=>
  typeof x==="string" && x.length>0 && x.length<=200;
const scopes=(x:unknown):readonly string[]=>
  typeof x==="string"?x.split(/\s+/).filter(Boolean):[];
/**
 * The optional key resolver is injected only by trusted tests/embedded runtimes;
 * the public HTTP endpoint always uses the issuer's configured JWKS.
 */
export async function verifyPdpBearer(
  header:string|null,
  config:PdpAuthConfig,
  trustedKeys?:Parameters<typeof jwtVerify>[1],
):Promise<AuthenticatedPdpCaller> {
  if(!config.issuer||!config.audience||!config.jwksUrl||
    !config.allowedClientIds.length||!config.requiredScope){
    throw new PdpAuthenticationError("configuration_error","PDP trust configuration incomplete");
  }
  for(const endpoint of [config.issuer,config.audience,config.jwksUrl]){
    let uri:URL;
    try{uri=new URL(endpoint);}catch{
      throw new PdpAuthenticationError("configuration_error","Invalid PDP trust URL");
    }
    if(uri.protocol!=="https:"||uri.username||uri.password||uri.hash||uri.search){
      throw new PdpAuthenticationError("configuration_error","PDP trust endpoints must use HTTPS");
    }
  }
  const token=/^Bearer ([A-Za-z0-9._~+\/-]{12,8192})$/.exec(header??"")?.[1];
  if(!token)throw new PdpAuthenticationError("unauthorized","Missing bearer token");
  let payload:JWTPayload;
  try{
    ({payload}=await jwtVerify(token,trustedKeys??cachedKeys(config.jwksUrl),{
      issuer:config.issuer,audience:config.audience,
      algorithms:["RS256","ES256","EdDSA"],clockTolerance:5,
      maxTokenAge:"10m",
    }));
  }catch{
    throw new PdpAuthenticationError("unauthorized","PDP token is not verifiable");
  }
  const tenantId=payload.awc_tenant_id;
  const client=payload.azp??payload.client_id;
  const scope=scopes(payload.scope);
  const sub=payload.sub;
  if(!bounded(tenantId)||!bounded(sub)||!bounded(client)||
     !config.allowedClientIds.includes(client)||
     !scope.includes(config.requiredScope)||!Number.isFinite(payload.iat)) {
    throw new PdpAuthenticationError("unauthorized","Missing trusted PDP identity, audience or scope");
  }
  return {tenantId,subjectId:sub,clientId:client,scopes:scope};
}
