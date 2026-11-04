import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

export interface AuthConfig {
  readonly issuer?:string | undefined;
  readonly jwksUrl?:string | undefined;
  readonly mcpAudience?:string | undefined;
  readonly approvalAudience?:string | undefined;
  readonly approvalClientId?:string | undefined;
  readonly allowedApprovalAcr?:readonly string[];
  readonly sandboxBuyerToken?:string | undefined;
  readonly sandboxHumanToken?:string | undefined;
}
export interface VerifiedActor {
  readonly buyerId:string;
  readonly subject:string;
  readonly kind:"agent"|"human";
  readonly scopes:readonly string[];
  readonly ceremony?:"interactive-oidc"|"local-sandbox-only";
}
export class AuthError extends Error{
  constructor(readonly code:"unauthorized"|"unavailable",message:string){super(message);this.name="AuthError";}
}
const keys=new Map<string,ReturnType<typeof createRemoteJWKSet>>();
function getKeys(url:string){
  let jwks=keys.get(url);
  if(!jwks){jwks=createRemoteJWKSet(new URL(url));keys.set(url,jwks);}
  return jwks;
}
async function equal(a:string,b:string|undefined):Promise<boolean>{
  if(!b||b.length<32||a.length!==b.length)return false;
  const enc=new TextEncoder();
  const [left,right]=await Promise.all([crypto.subtle.digest("SHA-256",enc.encode(a)),crypto.subtle.digest("SHA-256",enc.encode(b))]);
  const x=new Uint8Array(left),y=new Uint8Array(right);
  let diff=0;for(let i=0;i<x.length;i++)diff|=x[i]!^y[i]!;
  return diff===0;
}
const bearer=(header:string|null)=>{
  const match=/^Bearer ([A-Za-z0-9_.~+\/-]+)$/.exec(header??"");
  return match?.[1]??"";
};
function parseScopes(payload:JWTPayload):string[]{
  const raw=payload.scope;
  return typeof raw==="string" ? raw.split(/\s+/).filter(Boolean) : [];
}
const expectString=(x:unknown,name:string)=>{
  if(typeof x!=="string"||x.length<1||x.length>200)throw new AuthError("unauthorized","Missing valid "+name);
  return x;
};
export async function identifyActor(
  authorization:string|null,
  purpose:"mcp"|"human",
  config:AuthConfig,
  localSandbox=false,
):Promise<VerifiedActor|null>{
  const token=bearer(authorization);
  if(!token)return null;
  if(localSandbox && purpose==="mcp" && await equal(token,config.sandboxBuyerToken)) {
    return {buyerId:"sandbox-buyer",subject:"sandbox-agent",kind:"agent",scopes:[
      "catalog:read","quotes:write","work:prepare","work:read","work:execute","billing:checkout",
    ]};
  }
  if(localSandbox && purpose==="human" && await equal(token,config.sandboxHumanToken)){
    return {buyerId:"sandbox-buyer",subject:"sandbox-human",kind:"human",scopes:["work:approve","billing:dev-fund"],
      ceremony:"local-sandbox-only"};
  }
  const {issuer,jwksUrl,mcpAudience,approvalAudience,approvalClientId}=config;
  if(!issuer||!jwksUrl||!mcpAudience||!approvalAudience) return null;
  if(new URL(issuer).protocol!=="https:"||new URL(jwksUrl).protocol!=="https:"){
    throw new AuthError("unavailable","OIDC configuration must use HTTPS");
  }
  try{
    const audience=purpose==="mcp"?mcpAudience:approvalAudience;
    const {payload}=await jwtVerify(token,getKeys(jwksUrl),{
      issuer,audience,algorithms:["RS256","ES256","EdDSA"],clockTolerance:5,
    });
    const scopes=parseScopes(payload);
    const buyerId=expectString(payload.awc_buyer_id,"buyer identity");
    const subject=expectString(payload.sub,"subject");
    if(purpose==="human"){
      const client=payload.azp??payload.client_id;
      if(!approvalClientId||client!==approvalClientId||!scopes.includes("work:approve")||
        !config.allowedApprovalAcr?.includes(String(payload.acr??""))||
        typeof payload.auth_time!=="number"||
        Date.now()/1000-payload.auth_time>300 ||
        payload.auth_time>Date.now()/1000+5 ||
        payload.act!==undefined){
        throw new AuthError("unauthorized","Fresh, interactive approval authorization required");
      }
      return {buyerId,subject,kind:"human",scopes,ceremony:"interactive-oidc"};
    }
    if(!scopes.includes("catalog:read"))return null;
    return {buyerId,subject,kind:"agent",scopes};
  }catch(error){
    if(error instanceof AuthError)throw error;
    return null;
  }
}
export function requireScope(actor:VerifiedActor|null,scope:string):VerifiedActor{
  if(!actor||!actor.scopes.includes(scope))throw new AuthError("unauthorized","Missing required authorization");
  return actor;
}
