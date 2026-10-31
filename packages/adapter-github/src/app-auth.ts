import { SignJWT, importPKCS8 } from "jose";
import { AdapterError } from "@awc/adapter-sdk";

export interface GitHubCredentialProvider {
  readonly tokenFor: (installationId: number, repositoryId: number) => Promise<string>;
}
export interface GitHubAppAuthConfig {
  readonly appId: string;
  readonly privateKeyPem: string;
  readonly fetcher?: typeof fetch;
  readonly now?: () => number;
}

/** Actual GitHub App RS256 installation-token exchange; secrets remain server-side. */
export function createGitHubAppCredentials(config:GitHubAppAuthConfig):GitHubCredentialProvider {
  if(!/^\d+$/.test(config.appId)||!config.privateKeyPem.includes("BEGIN PRIVATE KEY")) {
    throw new AdapterError("invalid_input","Valid GitHub App ID and PKCS8 private key required");
  }
  const fetcher=config.fetcher??fetch,now=config.now??Date.now;
  let cachedKey: Promise<CryptoKey | Uint8Array> | undefined;
  const cache=new Map<string,{token:string;expiresAt:number}>();
  return {
    tokenFor:async(installationId,repositoryId)=>{
      if(!Number.isSafeInteger(installationId)||installationId<=0||
        !Number.isSafeInteger(repositoryId)||repositoryId<=0)
        throw new AdapterError("invalid_input","Invalid GitHub repository/installation IDs");
      const key=installationId+":"+repositoryId,prior=cache.get(key);
      if(prior&&prior.expiresAt-now()>120_000)return prior.token;
      try {
        cachedKey??=importPKCS8(config.privateKeyPem,"RS256");
        const privateKey=await cachedKey;
        const seconds=Math.floor(now()/1000);
        const jwt=await new SignJWT({})
          .setProtectedHeader({alg:"RS256",typ:"JWT"})
          .setIssuer(config.appId)
          .setIssuedAt(seconds-60)
          .setExpirationTime(seconds+540)
          .sign(privateKey);
        const response=await fetcher("https://api.github.com/app/installations/"+installationId+"/access_tokens",{
          method:"POST",headers:{
            accept:"application/vnd.github+json",
            authorization:"Bearer "+jwt,
            "content-type":"application/json",
            "x-github-api-version":"2026-03-10",
          },
          body:JSON.stringify({repository_ids:[repositoryId],permissions:{issues:"write"}}),
          redirect:"error",
          signal:AbortSignal.timeout(15_000),
        });
        if(response.status!==201)throw new AdapterError("unauthorized","GitHub App installation token not issued");
        const data=await response.json() as {
          token?:unknown;expires_at?:unknown;
          permissions?:{issues?:unknown};
          repositories?:Array<{id?:number}>;
        };
        const expiresAt=Date.parse(String(data.expires_at??""));
        if(typeof data.token!=="string"||data.token.length<10||!Number.isFinite(expiresAt)||
           expiresAt-now()<120_000||data.permissions?.issues!=="write"||
           (data.repositories!==undefined && !data.repositories.some(r=>r.id===repositoryId))) {
          throw new AdapterError("unauthorized","GitHub installation token lacks required scope");
        }
        cache.set(key,{token:data.token,expiresAt});
        return data.token;
      }catch(e){
        if(e instanceof AdapterError)throw e;
        throw new AdapterError("unavailable","GitHub App authentication temporarily unavailable");
      }
    }
  };
}
