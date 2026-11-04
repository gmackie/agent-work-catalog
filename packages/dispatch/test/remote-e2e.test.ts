import { describe,expect,it } from "vitest";
import { Effect } from "effect";
import { makeMarketplace,inMemoryMarketplaceStore } from "@awc/marketplace";
import { makeCommerce,sandboxExecutor,type WorkStateStore,type WorkSnapshot } from "@awc/commerce";
import { createRemoteHttpExecutor } from "@awc/adapter-remote-http";
import { handleRequest as remoteWorkerHandler,type D1Database } from "../../../examples/remote-executor/src/index.ts";
import { makeTrustedDispatcher,externalDisclosureDigest,inMemoryDispatchStore,type TrustedExecutorBinding } from "../src/index.ts";

const key="awcsample-shared-remote-test-key-1234567890";
const binding:TrustedExecutorBinding={
  id:"remote.fixture",origin:"https://executor.example/",
  offeringId:"offering:modbus-report",offeringVersion:"1",
  taskTypeId:"task:modbus-diagnostics",outputMediaTypes:["application/json"],
  maxCostMinorUnits:"3500",maxDurationSeconds:120,
  dataClassification:"public",allowedEffects:[],executionMode:"synthetic-test-only",
};
function d1(){
  type Row={provider_id:string;client_id:string;idempotency_key:string;request_digest:string;snapshot_json:string};
  const data=new Map<string,Row>();
  const db:D1Database={
    prepare:(sql:string)=>{
      let args:(string|number|null)[]=[];
      const st={
        bind(...values:(string|number|null)[]){args=values;return st;},
        async run(){
          if(sql.startsWith("INSERT")){
            const [provider_id,client_id,idempotency_key,request_digest,snapshot_json]=args as
              [string,string,string,string,string];
            if(!data.has(idempotency_key))
              data.set(idempotency_key,{provider_id,client_id,idempotency_key,request_digest,snapshot_json});
          }
        },
        async first<T>():Promise<T|null>{
          const found=sql.includes("WHERE idempotency_key=")
            ?data.get(String(args[0]))
            :[...data.values()].find(x=>x.provider_id===args[0]);
          return found as T??null;
        },
      };
      return st;
    },
  };
  return {db,data};
}
function stateStore():WorkStateStore{
  const states=new Map<string,WorkSnapshot>();
  return {
    initialize:async(work,at)=>{
      let state=states.get(work.id);
      if(!state){
        state={id:work.id,buyerId:work.buyerId,quoteDigest:work.quoteDigest,
          status:"prepared_unfunded",version:0,attempts:0,updatedAt:at};
        states.set(work.id,state);
      }
      return state;
    },
    get:async(buyer,id)=>{const x=states.get(id);return x?.buyerId===buyer?x:undefined;},
    cas:async(before,after)=>{
      const x=states.get(before.id);
      if(!x||x.version!==before.version||x.status!==before.status)return false;
      states.set(before.id,after);return true;
    },
    recoverable:async()=>[],
  };
}
const run=<T>(effect:Effect.Effect<T,any>)=>Effect.runPromise(effect);

async function setup(dropFirstResult=false){
  let nowValue=Date.parse("2026-11-01T15:00:00Z");
  const now=()=>nowValue;
  const marketplace=makeMarketplace(inMemoryMarketplaceStore(),now);
  const quote=await run(marketplace.requestQuote("buyer-A",{
    offeringId:binding.offeringId,scope:"Diagnose PUBLIC SAMPLE Modbus timeout observations",
    idempotencyKey:"quote_e2e_remote_test",
  }));
  const work=await run(marketplace.prepareWork("buyer-A",{
    quoteId:quote.id,idempotencyKey:"work_e2e_remote_test",
    dataClassification:"public",
    inputs:[{name:"observations",mediaType:"text/plain",kind:"inline",
      data:"PUBLIC SYNTHETIC DATA: HMI timeouts 100ms after start"}],
  }));
  const commerce=makeCommerce(marketplace,stateStore(),sandboxExecutor,{
    now,enableSandboxFunding:true,
    externalDisclosureDigest:(w,q)=>w.offeringId===binding.offeringId
      ?externalDisclosureDigest(w,q,binding):Promise.resolve(undefined),
  });
  const remoteD1=d1();
  const env={ENABLE_EXAMPLE_EXECUTOR:"true",AWC_SHARED_KEY:key,DB:remoteD1.db};
  let starts=0,lose=true;
  const remote=createRemoteHttpExecutor({
    id:binding.id,baseUrl:binding.origin,allowedHost:"executor.example",
    sharedKey:key,supportedTaskTypes:[binding.taskTypeId],
    fetcher:(async(url:RequestInfo|URL,init?:RequestInit)=>{
      const request=new Request(url,init);
      if(request.method==="POST" && new URL(request.url).pathname==="/v1/executions")starts++;
      const result=await remoteWorkerHandler(request,env);
      if(dropFirstResult&&lose && request.method==="POST" &&
         new URL(request.url).pathname==="/v1/executions"){
        lose=false;
        throw new TypeError("Network lost after server committed idempotency record");
      }
      return result;
    }) as typeof fetch,
  });
  const dispatcher=makeTrustedDispatcher(commerce,inMemoryDispatchStore(),remote,binding,now);
  await run(commerce.approve("buyer-A",work.id,{
    buyerId:"buyer-A",approverSubject:"human-reviewed-contract",reviewedDigest:quote.termsDigest,
    ceremony:"local-sandbox-only",
  }));
  const planned=await run(dispatcher.plan("buyer-A",work.id));
  await run(commerce.consentExternal("buyer-A",work.id,{
    buyerId:"buyer-A",approverSubject:"human-reviewed-disclosure",
    reviewedDigest:planned.disclosureDigest,ceremony:"local-sandbox-only",
  }));
  await run(commerce.sandboxFund("buyer-A",work.id));
  await run(commerce.start("buyer-A",work.id));
  return {dispatcher,commerce,remoteD1,work,getStarts:()=>starts,tick:(ms:number)=>{nowValue+=ms;}};
}

describe("Full trusted broker-to-remote Worker integration",()=>{
  it("dispatches an approved/funded public work order over authenticated HTTP and persists verified artifacts",async()=>{
    const f=await setup();
    const result=await run(f.dispatcher.advance("buyer-A",f.work.id));
    expect(result.status).toBe("finalized");
    expect(result.handle?.providerExecutionId).toMatch(/^job_/);
    expect(result.request.taskTypeId).toBe("task:modbus-diagnostics");
    expect(result.result?.artifacts[0]?.mediaType).toBe("application/json");
    expect(result.result?.artifacts[0]?.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect((await run(f.commerce.preview("buyer-A",f.work.id))).state.status).toBe("submitted");
    expect(f.remoteD1.data.size).toBe(1);
    expect(f.getStarts()).toBe(1);
    expect((await run(f.dispatcher.advance("buyer-A",f.work.id))).status).toBe("finalized");
    expect(f.getStarts()).toBe(1);
  });
  it("recovers a remote job that was accepted just before the HTTP response was lost",async()=>{
    const f=await setup(true);
    const first=await run(f.dispatcher.advance("buyer-A",f.work.id));
    expect(first.status).toBe("uncertain");
    expect(f.remoteD1.data.size).toBe(1);
    f.tick(50_000);
    const recovered=await run(f.dispatcher.advance("buyer-A",f.work.id));
    expect(recovered.status).toBe("finalized");
    expect(f.getStarts()).toBe(1);
    expect((await run(f.commerce.preview("buyer-A",f.work.id))).state.status).toBe("submitted");
  });
});
