import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { createRemoteHttpExecutor, verifyAwcRequest } from "../src/index.ts";
import { type ExecutionRequest } from "@awc/adapter-sdk";
import { probeExecutor } from "@awc/adapter-sdk/conformance";

const secret="remote-adapter-signature-key-very-long-demo-001";
const input:ExecutionRequest={
  schemaVersion:"awc.execution/v1",executionId:"exec_abc",attemptId:"attempt_1",
  idempotencyKey:"idem_test_123456",workOrderId:"work_abc",
  contractDigest:"a".repeat(64),taskTypeId:"task:example",offeringId:"offering:example",
  inputs:[{name:"brief",kind:"inline",mediaType:"text/plain",data:"Give a report"}],
  requiredOutputs:[{role:"report",mediaType:"application/json"}],
  constraints:{maxCost:{currency:"USD",minorUnits:"2500"},allowedEffects:[],
    dataClassification:"public",maxDurationSeconds:300},
};
const handle={executionId:input.executionId,providerExecutionId:"job_42",status:"completed" as const};
function example(fetcher:typeof fetch){
  return createRemoteHttpExecutor({
    id:"sample.remote",baseUrl:"https://worker.example",allowedHost:"worker.example",
    sharedKey:secret,supportedTaskTypes:["task:example"],fetcher,
  });
}
describe("signed remote executor",()=>{
  it("reuses idempotency key and securely reconciles the same job",async()=>{
    let created=0;const seen:string[]=[];
    const fetcher=async (url:RequestInfo|URL,init?:RequestInit)=>{
      const request=new Request(url,init);
      const valid=await verifyAwcRequest(request,secret);
      seen.push(valid.idempotencyKey);
      const path=new URL(request.url).pathname;
      if(path==="/v1/executions"){
        created++;
        expect(JSON.parse(valid.body).contractDigest).toBe(input.contractDigest);
        return Response.json({schemaVersion:"awc.executor/v1",handle},{status:202});
      }
      if(path.includes("by-idempotency"))return Response.json({schemaVersion:"awc.executor/v1",handle});
      if(path.endsWith("/cancel"))return Response.json({schemaVersion:"awc.executor/v1",handle,status:"already_terminal"});
      return Response.json({schemaVersion:"awc.executor/v1",snapshot:{handle,status:"completed",
        updatedAt:"2026-10-31T18:00:00Z",result:{
          orderId:input.workOrderId,summary:"Done",producedAt:"2026-10-31T18:00:00Z",artifacts:[],
        }}});
    };
    const worker=example(fetcher as typeof fetch);
    const result=await probeExecutor(worker,input);
    expect(result.snapshot.result?.orderId).toBe(input.workOrderId);
    expect(created).toBe(2); // Remote receives both POSTs but must de-duplicate by key.
    expect(new Set(seen).has(input.idempotencyKey)).toBe(true);
    expect((await Effect.runPromise(worker.cancel(result.handle))).status).toBe("already_terminal");
  });
  it("reports ambiguous POST network failures rather than blind retries",async()=>{
    const executor=example((async()=>{throw new TypeError("broken network");}) as typeof fetch);
    await expect(Effect.runPromise(executor.start(input))).rejects.toThrow("may have succeeded");
  });
  it("rejects unapproved origins and redirects",()=>{
    expect(()=>createRemoteHttpExecutor({id:"bad.remote",baseUrl:"http://127.0.0.1",
      allowedHost:"127.0.0.1",sharedKey:secret,supportedTaskTypes:["task:example"]})).toThrow();
    expect(()=>createRemoteHttpExecutor({id:"bad.remote",baseUrl:"https://evil.example",
      allowedHost:"good.example",sharedKey:secret,supportedTaskTypes:["task:example"]})).toThrow();
  });
  it("rejects changed signed bytes",async()=>{
    const request=new Request("https://worker.example/v1/executions",{method:"POST",
      headers:{"x-awc-timestamp":String(Date.now()),"x-awc-idempotency-key":input.idempotencyKey,
        "x-awc-signature":"a".repeat(64)},body:"{}"});
    await expect(verifyAwcRequest(request,secret)).rejects.toThrow();
  });
});
