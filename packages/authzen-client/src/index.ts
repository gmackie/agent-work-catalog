import type { AuthzenEvaluationRequest,AuthzenDecision } from "@awc/authzen";

/**
 * An AuthZEN 1.0 HTTP client intended for an AWC PEP to call Gatekeeper or an
 * independent PDP. The PDP endpoint and service token are supplied by trusted
 * deployment configuration, NEVER by an agent/model, tool argument or Offering.
 */
export interface RemotePdpConfig {
  readonly origin:string;
  readonly bearerToken:()=>Promise<string>;
  readonly timeoutMs?:number;
  readonly fetcher?:typeof fetch;
}
export class PdpUnavailable extends Error {
  readonly _tag="PdpUnavailable";
  constructor(readonly reason:"configuration"|"transport"|"invalid_response",message:string){
    super(message);this.name="PdpUnavailable";
  }
}
const record=(x:unknown):x is Record<string,unknown>=>
  !!x&&typeof x==="object"&&!Array.isArray(x);
export function createRemoteAuthzenPdp(cfg:RemotePdpConfig){
  let origin:URL;
  try{origin=new URL(cfg.origin);}catch{throw new PdpUnavailable("configuration","Invalid PDP origin");}
  if(origin.protocol!=="https:"||origin.username||origin.password||
    origin.search||origin.hash||origin.pathname!=="/"){
    throw new PdpUnavailable("configuration","PDP origin must be a registered HTTPS origin");
  }
  if(cfg.timeoutMs!==undefined && (!Number.isSafeInteger(cfg.timeoutMs)||
     cfg.timeoutMs<200||cfg.timeoutMs>30_000)){
    throw new PdpUnavailable("configuration","Invalid PDP timeout");
  }
  const endpoint=new URL("/access/v1/evaluation",origin);
  const fetcher=cfg.fetcher??fetch;
  return {
    evaluate:async(request:AuthzenEvaluationRequest):Promise<AuthzenDecision>=>{
      let bearer:string;
      try{bearer=await cfg.bearerToken();}catch{
        throw new PdpUnavailable("transport","Trusted service token unavailable");
      }
      if(!bearer||bearer.length<12||!/^[A-Za-z0-9._~+\/-]+$/.test(bearer)){
        throw new PdpUnavailable("configuration","Trusted service token missing");
      }
      let response:Response;
      try {
        response=await fetcher(endpoint,{
          method:"POST",headers:{
            authorization:"Bearer "+bearer,
            "content-type":"application/json",accept:"application/json",
            "cache-control":"no-store",
          },
          body:JSON.stringify(request),redirect:"error",
          signal:AbortSignal.timeout(cfg.timeoutMs??3000),
        });
      }catch{
        throw new PdpUnavailable("transport","PDP request failed or timed out");
      }
      if(!response.ok || !response.headers.get("content-type")?.includes("application/json")){
        throw new PdpUnavailable("transport","PDP returned unsuccessful/non-JSON response");
      }
      let data:unknown;
      try{data=await response.json();}catch{
        throw new PdpUnavailable("invalid_response","PDP response is not JSON");
      }
      if(!record(data)||typeof data.decision!=="boolean"||
        (data.context!==undefined&&!record(data.context))){
        throw new PdpUnavailable("invalid_response","PDP decision is not conformant");
      }
      return {decision:data.decision,...(data.context===undefined?{}:{context:data.context})};
    },
  };
}
