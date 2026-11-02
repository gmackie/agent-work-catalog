import {describe,expect,it} from "vitest";
import {createTokenExchangeClient} from "../src/index.ts";
const TOKEN="signed.subject.token.with-padding";
const config={
 endpoint:"https://issuer.example/oauth/token",
 clientId:"awc-pep",clientSecret:async()=>"secret-client-credential-123456",
 actorToken:async()=>"trusted.actor.service.access-token",
 audience:"https://gatekeeper.example",scope:"authzen:evaluate" as const,
};
describe("RFC 8693 exchanged PDP actor token",()=>{
 it("requests exact target audience, subject and signed actor token",async()=>{
  let called=false;
  const client=createTokenExchangeClient({...config,fetcher:async(_input,init)=>{
   called=true;
   expect(init?.method).toBe("POST");
   expect(init?.redirect).toBe("error");
   const form=new URLSearchParams(String(init?.body));
   expect(form.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:token-exchange");
   expect(form.get("subject_token")).toBe(TOKEN);
   expect(form.get("actor_token")).toBe("trusted.actor.service.access-token");
   expect(form.get("audience")).toBe(config.audience);
   expect(form.get("scope")).toBe("authzen:evaluate");
   return Response.json({access_token:"issued.signed.pdp-access-token",
     issued_token_type:"urn:ietf:params:oauth:token-type:access_token",
     token_type:"Bearer",expires_in:180});
  }});
  const result=await client.exchange(TOKEN);
  expect(called).toBe(true);expect(result.expiresIn).toBe(180);
 });
 it("rejects invalid subject, audience, identity endpoint, AS error and non-Bearer output",async()=>{
  expect(()=>createTokenExchangeClient({...config,endpoint:"http://169.254.169.254/token"})).toThrow();
  expect(()=>createTokenExchangeClient({...config,audience:"http://evil.example"})).toThrow();
  const exchange=createTokenExchangeClient({...config,fetcher:async()=>Response.json({
    access_token:"abc",token_type:"DPoP",issued_token_type:"unsupported",expires_in:100,
  })});
  await expect(exchange.exchange(TOKEN)).rejects.toThrow();
  await expect(exchange.exchange("bad")).rejects.toThrow();
  await expect(createTokenExchangeClient({...config,fetcher:async()=>new Response(null,{status:400})})
   .exchange(TOKEN)).rejects.toThrow();
 });
});
