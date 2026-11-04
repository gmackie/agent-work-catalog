import {describe,expect,it} from "vitest";
import {createAccessRequestClient} from "../src/index.ts";
import type {AuthzenEvaluationRequest,AuthzenDecision} from "@awc/authzen";
const origin="https://pdp.example";
const id="arq_"+"a".repeat(32);
const request:AuthzenEvaluationRequest={
 subject:{type:"identity",id:"principal:https%3A%2F%2Fissuer.example:sub:agent"},
 action:{name:"awc.work.start"},resource:{type:"gatekeeper-resource",id:"work:1"},
 context:{purpose:"awc-mcp:work.start"}
};
const hint:AuthzenDecision={decision:false,context:{
 evaluation_id:"evaluation-1234",reason:"approval_required",
 access_request:{endpoint:origin+"/access/v1/requests",expires_at:new Date(Date.now()+300000).toISOString()},
}};
const credentials=()=>Promise.resolve("signed.pdp.access-token.12345");
describe("AuthZEN approval draft request/status/re-evaluation",()=>{
 it("submits exact denial without granting an ability to approve",async()=>{
  const calls:string[]=[];
  const c=createAccessRequestClient({pdpOrigin:origin,bearerToken:credentials,fetcher:async(url,init)=>{
   calls.push(String(url));expect(init?.redirect).toBe("error");
   if(init?.method==="POST"){
    const body=JSON.parse(String(init.body));
    expect(body.denial.evaluation_id).toBe("evaluation-1234");
    expect(body.action.name).toBe("awc.work.start");
    expect(body.resource.id).toBe("work:1");
    return Response.json({task:{id,status:"pending",status_endpoint:origin+"/access/v1/requests/"+id}});
   }
   return Response.json({task:{id,status:"approved",status_endpoint:origin+"/access/v1/requests/"+id},
    result:{mode:"reevaluate",approval:{id:"apr_01234567890123456789012345678901",
     approved_until:new Date(Date.now()+600000).toISOString()}}});
  }});
  expect((await c.request(request,hint,"idempotency-key-123")).task.status).toBe("pending");
  const approved=await c.status(id);
  expect(c.reevaluate(request,approved).context?.approval).toBeDefined();
  expect(calls).toEqual([origin+"/access/v1/requests",origin+"/access/v1/requests/"+id]);
 });
 it("will not follow a denial-provided endpoint, approve untrusted tasks, or re-evaluate expired grants",async()=>{
  const c=createAccessRequestClient({pdpOrigin:origin,bearerToken:credentials});
  await expect(c.request(request,{...hint,context:{...hint.context,
   access_request:{endpoint:"https://attacker.example/access/v1/requests",
    expires_at:new Date(Date.now()+300000).toISOString()}}},"idempotency-key-123")).rejects.toThrow();
  expect(()=>c.reevaluate(request,{task:{id,status:"pending",
   status_endpoint:origin+"/access/v1/requests/"+id}})).toThrow();
  expect(()=>c.reevaluate(request,{task:{id,status:"approved",
   status_endpoint:"https://attacker.example/access/v1/requests/"+id},
   result:{mode:"reevaluate",approval:{id:"approval",approved_until:new Date(Date.now()+600000).toISOString()}}})).toThrow();
 });
});
