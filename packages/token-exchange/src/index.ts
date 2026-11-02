/**
 * RFC 8693 OAuth 2.0 Token Exchange client.
 * The authorization server alone can issue delegated tokens. No local signing,
 * subject impersonation, JWT fabrication, or token-decoding as a trust source.
 */
export interface TokenExchangeConfig {
  readonly endpoint:string;
  readonly clientId:string;
  readonly clientSecret:()=>Promise<string>;
  readonly audience:string;
  readonly actorToken:()=>Promise<string>;
  readonly scope:"authzen:evaluate";
  readonly fetcher?:typeof fetch;
  readonly timeoutMs?:number;
}
export class ExchangeError extends Error{
  readonly _tag="ExchangeError";
  constructor(readonly reason:"configuration"|"unavailable"|"rejected"|"invalid_response",
    message:string){super(message);this.name="ExchangeError";}
}
const ACCESS="urn:ietf:params:oauth:token-type:access_token";
const GRANT="urn:ietf:params:oauth:grant-type:token-exchange";
const validToken=(s:string)=>s.length>=12&&s.length<=16384&&/^[A-Za-z0-9._~+\/-]+$/.test(s);
const url=(value:string)=>{
  let uri:URL;
  try{uri=new URL(value);}catch{throw new ExchangeError("configuration","Invalid token exchange endpoint");}
  if(uri.protocol!=="https:"||uri.username||uri.password||uri.hash||
    uri.search||uri.pathname==="/"){
    throw new ExchangeError("configuration","Token endpoint must be a pinned HTTPS path");
  }
  return uri;
};
export function createTokenExchangeClient(cfg:TokenExchangeConfig) {
  const endpoint=url(cfg.endpoint);
  let audience:string;
  try{
    const target=new URL(cfg.audience);
    if(target.protocol!=="https:"||target.username||target.password||target.search||target.hash){
      throw Error("Not HTTPS");
    }
    audience=target.href.replace(/\/$/,"");
  }catch{throw new ExchangeError("configuration","Invalid pinned PDP resource audience");}
  if(!cfg.clientId||cfg.clientId.length>200||cfg.scope!=="authzen:evaluate"||
    (cfg.timeoutMs!==undefined&&(!Number.isSafeInteger(cfg.timeoutMs)||
    cfg.timeoutMs<200||cfg.timeoutMs>15_000))){
    throw new ExchangeError("configuration","Invalid trusted token exchange configuration");
  }
  return {
    exchange:async(subjectToken:string):Promise<{accessToken:string;expiresIn:number}>=>{
      if(!validToken(subjectToken))throw new ExchangeError("rejected","Missing verified MCP subject token");
      let secret:string,actor:string;
      try{[secret,actor]=await Promise.all([cfg.clientSecret(),cfg.actorToken()]);}
      catch{throw new ExchangeError("unavailable","Client credentials unavailable");}
      if(!secret||secret.length<16||!validToken(actor)){
        throw new ExchangeError("configuration","Registered client or actor credentials unavailable");
      }
      const body=new URLSearchParams({
        grant_type:GRANT,
        subject_token:subjectToken,
        subject_token_type:ACCESS,
        actor_token:actor,
        actor_token_type:ACCESS,
        requested_token_type:ACCESS,
        audience,
        scope:cfg.scope,
      });
      const encoded=new TextEncoder().encode(cfg.clientId+":"+secret);
      const basic=btoa(String.fromCharCode(...encoded));
      let response:Response;
      try{
        response=await (cfg.fetcher??fetch)(endpoint,{
          method:"POST",redirect:"error",
          headers:{
            authorization:"Basic "+basic,
            "content-type":"application/x-www-form-urlencoded",
            accept:"application/json","cache-control":"no-store",
          },
          body:body.toString(),signal:AbortSignal.timeout(cfg.timeoutMs??3000),
        });
      }catch{throw new ExchangeError("unavailable","Token exchange unavailable");}
      if(response.status!==200||!response.headers.get("content-type")?.includes("application/json")){
        throw new ExchangeError("rejected","Authorization server rejected token exchange");
      }
      let raw:unknown;
      try{raw=await response.json();}catch{throw new ExchangeError("invalid_response","Non-JSON token response");}
      if(!raw||typeof raw!=="object"||Array.isArray(raw)){
        throw new ExchangeError("invalid_response","Malformed token response");
      }
      const result=raw as Record<string,unknown>;
      if(result.token_type!=="Bearer"||result.issued_token_type!==ACCESS||
        typeof result.access_token!=="string"||!validToken(result.access_token)||
        !Number.isSafeInteger(result.expires_in)||Number(result.expires_in)<1||
        Number(result.expires_in)>600){
        throw new ExchangeError("invalid_response","Unsupported or long-lived issued token");
      }
      return {accessToken:result.access_token,expiresIn:result.expires_in as number};
    },
  };
}
