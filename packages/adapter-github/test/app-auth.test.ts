import {describe,expect,it} from "vitest";
import {decodeJwt,exportPKCS8,generateKeyPair} from "jose";
import {createGitHubAppCredentials} from "../src/app-auth.ts";

describe("GitHub App installation authentication",()=>{
  it("issues RS256 JWT and requests repository-scoped issues:write credentials",async()=>{
    const keys=await generateKeyPair("RS256",{extractable:true});
    const privateKeyPem=await exportPKCS8(keys.privateKey);
    const now=Date.parse("2026-10-31T18:30:00Z");
    let calls=0;
    const adapter=createGitHubAppCredentials({
      appId:"123456",privateKeyPem,now:()=>now,
      fetcher:(async(input:RequestInfo|URL,init?:RequestInit)=>{
        calls++;
        const req=new Request(input,init);
        expect(new URL(req.url).pathname).toBe("/app/installations/987/access_tokens");
        expect(req.headers.get("x-github-api-version")).toBe("2026-03-10");
        const token=req.headers.get("authorization")!.slice("Bearer ".length);
        expect(decodeJwt(token).iss).toBe("123456");
        const body=await req.json() as {repository_ids:number[];permissions:{issues:string}};
        expect(body).toEqual({repository_ids:[123],permissions:{issues:"write"}});
        return Response.json({
          token:"ghs_stateless_jwt_format_is_not_a_fixed_length_string",
          expires_at:new Date(now+3600_000).toISOString(),
          permissions:{issues:"write"},repositories:[{id:123}],
        },{status:201});
      }) as typeof fetch,
    });
    const token=await adapter.tokenFor(987,123);
    expect(token).toContain("ghs_");
    expect(await adapter.tokenFor(987,123)).toBe(token);
    expect(calls).toBe(1);
  });
  it("fails closed when GitHub returns insufficient permission or wrong repository",async()=>{
    const {privateKey}=await generateKeyPair("RS256",{extractable:true});
    const adapter=createGitHubAppCredentials({
      appId:"123456",privateKeyPem:await exportPKCS8(privateKey),
      fetcher:(async()=>Response.json({
        token:"ghs_a_long_but_wrong_scope_token_123456789",
        expires_at:new Date(Date.now()+3600_000).toISOString(),
        permissions:{issues:"read"},repositories:[{id:999}],
      },{status:201})) as typeof fetch,
    });
    await expect(adapter.tokenFor(987,123)).rejects.toThrow();
  });
});
