import {describe,expect,it} from "vitest";
import {createRemoteAuthzenPdp} from "../src/index.ts";
import type {AuthzenEvaluationRequest} from "@awc/authzen";
const req:AuthzenEvaluationRequest={
 subject:{type:"identity",id:"agent:manager"},action:{name:"telemetry.read"},
 resource:{type:"awc-managed-entity",id:"asset:1"},
 context:{awc_proposal_id:"p",awc_proposal_revision:"f".repeat(64)},
};
describe("Gatekeeper-compatible AuthZEN 1.0 PEP client",()=>{
 it("sends authenticated single-evaluation request with fixed HTTPS origin",async()=>{
  let invoked=false;
  const pdp=createRemoteAuthzenPdp({
    origin:"https://gatekeeper.example",
    bearerToken:async()=> "synthetic-opaque-service-token-long",
    fetcher:async(input,init)=>{
      invoked=true;
      expect(String(input)).toBe("https://gatekeeper.example/access/v1/evaluation");
      expect(init?.method).toBe("POST");
      expect(new Headers(init?.headers).get("authorization")).toMatch(/^Bearer synthetic/);
      expect(init?.redirect).toBe("error");
      expect(JSON.parse(String(init?.body))).toEqual(req);
      return new Response(JSON.stringify({decision:true}),{status:200,
        headers:{"content-type":"application/json"}});
    },
  });
  expect((await pdp.evaluate(req)).decision).toBe(true);
  expect(invoked).toBe(true);
 });
 it("fails closed on forged/malformed bool, non-JSON, redirects and network failure",async()=>{
  const make=(fetcher:typeof fetch)=>createRemoteAuthzenPdp({
   origin:"https://gatekeeper.example",bearerToken:async()=>"synthetic-opaque-service-token-long",
   fetcher,
  });
  for(const payload of [{decision:"yes"},{},[]]){
    const pdp=make(async()=>new Response(JSON.stringify(payload),{
      status:200,headers:{"content-type":"application/json"}}));
    await expect(pdp.evaluate(req)).rejects.toThrow();
  }
  await expect(make(async()=>new Response("denied",{status:302})).evaluate(req)).rejects.toThrow();
  await expect(make(async()=>{throw Error("timeout");}).evaluate(req)).rejects.toThrow();
  expect(()=>make(async()=>new Response()) && createRemoteAuthzenPdp({
    origin:"http://169.254.169.254",bearerToken:async()=>"token"
  })).toThrow();
 });
});
