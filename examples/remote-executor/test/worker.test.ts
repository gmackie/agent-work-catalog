import {describe,expect,it} from "vitest";
import {Effect} from "effect";
import {createRemoteHttpExecutor} from "@awc/adapter-remote-http";
import {probeExecutor} from "@awc/adapter-sdk/conformance";
import type {ExecutionRequest} from "@awc/adapter-sdk";
import {handleRequest,type D1Database} from "../src/index.ts";

const key="awc-remote-example-shared-signing-key-0123456789";
const fixture:ExecutionRequest={
  schemaVersion:"awc.execution/v1",executionId:"exec_sample_1",attemptId:"attempt_1",
  idempotencyKey:"idem_sample_1",workOrderId:"work_sample_1",
  contractDigest:"a".repeat(64),taskTypeId:"task:example",offeringId:"offering:example",
  inputs:[{kind:"inline",name:"description",mediaType:"text/plain",data:"Calculate a sample result"}],
  requiredOutputs:[{role:"report",mediaType:"application/json"}],
  constraints:{maxCost:{currency:"USD",minorUnits:"100"},allowedEffects:[],
    dataClassification:"public",maxDurationSeconds:120},
};
function fakeD1():D1Database {
  type Row={provider_id:string;client_id:string;idempotency_key:string;request_digest:string;snapshot_json:string};
  const values=new Map<string,Row>();
  return {prepare:(sql:string)=>{
    let args:(string|number|null)[]=[];
    const stmt={
      bind(...v:(string|number|null)[]){args=v;return stmt;},
      async run(){
        if(sql.startsWith("INSERT")){
          const [provider_id,client_id,idempotency_key,request_digest,snapshot_json]=args as [string,string,string,string,string];
          if(!values.has(idempotency_key))values.set(idempotency_key,{provider_id,client_id,idempotency_key,request_digest,snapshot_json});
        }
      },
      async first<T>():Promise<T|null>{
        const row=sql.includes("WHERE idempotency_key=")
          ?values.get(String(args[0]))
          :[...values.values()].find(x=>x.provider_id===args[0]);
        return row as T ?? null;
      },
    };
    return stmt;
  }};
}
describe("End-to-end signed HTTP executor",()=>{
  it("runs authenticated requests through a remote Worker HTTP boundary with replay recovery",async()=>{
    const env={DB:fakeD1(),ENABLE_EXAMPLE_EXECUTOR:"true",AWC_SHARED_KEY:key};
    const worker=createRemoteHttpExecutor({
      id:"example.remote",baseUrl:"https://remote.example",allowedHost:"remote.example",
      sharedKey:key,supportedTaskTypes:["task:example"],
      fetcher:((url:RequestInfo|URL,init?:RequestInit)=>
        handleRequest(new Request(url,init),env)) as typeof fetch,
    });
    const result=await probeExecutor(worker,fixture);
    expect(result.snapshot.status).toBe("completed");
    expect(result.snapshot.result?.artifacts[0]?.mediaType).toBe("application/json");
    expect((await Effect.runPromise(worker.cancel(result.handle))).status).toBe("already_terminal");
  });
  it("does not start without signed authority or when the example is disabled",async()=>{
    const env={DB:fakeD1(),ENABLE_EXAMPLE_EXECUTOR:"false",AWC_SHARED_KEY:key};
    const r=await handleRequest(new Request("https://remote.example/v1/executions",{method:"POST",body:"{}"}),env);
    expect(r.status).toBe(503);
  });
});
