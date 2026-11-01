import { describe,expect,it } from "vitest";
import { Effect } from "effect";
import { makeMarketplace,inMemoryMarketplaceStore,type Quote,type PreparedWork } from "@awc/marketplace";
import { makeCommerce,sandboxExecutor,type WorkStateStore,type WorkSnapshot } from "@awc/commerce";
import { AdapterError,type WorkExecutor,type ExecutionHandle,type ExecutionRequest } from "@awc/adapter-sdk";
import { externalDisclosureDigest,inMemoryDispatchStore,makeTrustedDispatcher,type TrustedExecutorBinding } from "../src/index.ts";

let time=Date.parse("2026-11-01T15:00:00Z");
const now=()=>time;
const binding:TrustedExecutorBinding={
  id:"sandbox.remote",origin:"https://remote.example/",
  offeringId:"offering:modbus-report",offeringVersion:"1",taskTypeId:"task:modbus-diagnostics",
  maxCostMinorUnits:"3500",outputMediaTypes:["application/json"],
  maxDurationSeconds:120,dataClassification:"public",allowedEffects:[],
  executionMode:"synthetic-test-only",
};
function workStates():WorkStateStore{
  const rows=new Map<string,WorkSnapshot>();
  return {
    initialize:async(work,now)=>{
      const prior=rows.get(work.id);
      if(prior)return prior;
      const state:WorkSnapshot={id:work.id,buyerId:work.buyerId,quoteDigest:work.quoteDigest,
        status:"prepared_unfunded",version:0,attempts:0,updatedAt:now};
      rows.set(work.id,state);return state;
    },
    get:async(buyer,id)=>{
      const x=rows.get(id);return x?.buyerId===buyer?x:undefined;
    },
    cas:async(before,after)=>{
      const previous=rows.get(before.id);
      if(!previous||previous.status!==before.status||previous.version!==before.version)return false;
      rows.set(before.id,after);return true;
    },
    recoverable:async()=>[],
  };
}
const get=<A>(effect:Effect.Effect<A,any>)=>Effect.runPromise(effect);
const fakeExecutor=(options:{
  start?: (request:ExecutionRequest)=>Promise<ExecutionHandle>;
  recover?: (request:ExecutionRequest)=>Promise<ExecutionHandle|null>;
  outputType?:string;
}={}):WorkExecutor=>{
  const handle:ExecutionHandle={executionId:"",providerExecutionId:"job_123",status:"completed"};
  return {
    manifest:{schemaVersion:"awc.adapter/v1",id:binding.id,version:"1.0.0",
      displayName:"Mock remote source",roles:["work-executor"],transport:"remote-http",
      supportedTaskTypes:[binding.taskTypeId],capabilities:["start","recover","inspect"]},
    start:request=>Effect.tryPromise({
      try:()=>options.start?options.start(request):Promise.resolve({...handle,executionId:request.executionId}),
      catch:()=>new AdapterError("outcome_unknown","Remote outcome uncertain"),
    }),
    recover:request=>Effect.tryPromise({
      try:()=>options.recover?options.recover(request):Promise.resolve({...handle,executionId:request.executionId}),
      catch:()=>new AdapterError("unavailable","Recovery temporary failure"),
    }),
    inspect:execution=>Effect.succeed({
      handle:execution,status:"completed",updatedAt:new Date(time).toISOString(),
      result:{orderId:activeWorkId,summary:"Synthetic specialist output",producedAt:new Date(time).toISOString(),
        artifacts:[{name:"findings.json",kind:"inline",mediaType:options.outputType??"application/json",
          data:{findings:[],notice:"Synthetic test report"}}]},
    }),
    cancel:execution=>Effect.succeed({handle:execution,status:"already_terminal"}),
  };
};
let activeWorkId="";
async function setup(executor:WorkExecutor=fakeExecutor()){
  time=Date.parse("2026-11-01T15:00:00Z");
  const marketplace=makeMarketplace(inMemoryMarketplaceStore(),now);
  const quote=await get(marketplace.requestQuote("buyer-1",{
    offeringId:binding.offeringId,scope:"Analyze Modbus connectivity observations in public test data",
    idempotencyKey:"quote_remote_test_123",
  }));
  const work=await get(marketplace.prepareWork("buyer-1",{
    quoteId:quote.id,dataClassification:"public",idempotencyKey:"work_remote_test_123",
    inputs:[{name:"observation",kind:"inline",mediaType:"text/plain",data:"Public synthetic timeout data"}],
  }));
  activeWorkId=work.id;
  const commerce=makeCommerce(marketplace,workStates(),sandboxExecutor,{now,
    enableSandboxFunding:true,externalDisclosureDigest:(w,q)=>
      w.offeringId===binding.offeringId?externalDisclosureDigest(w,q,binding):Promise.resolve(undefined),
  });
  const dispatch=makeTrustedDispatcher(commerce,inMemoryDispatchStore(),executor,binding,now);
  const approved=await get(commerce.approve("buyer-1",work.id,{
    buyerId:"buyer-1",approverSubject:"human",reviewedDigest:quote.termsDigest,
    ceremony:"local-sandbox-only",
  }));
  return {marketplace,quote,work,commerce,dispatch};
}
async function allow(f:Awaited<ReturnType<typeof setup>>){
  const {commerce,work,dispatch}=f;
  const plan=await get(dispatch.plan("buyer-1",work.id));
  await get(commerce.consentExternal("buyer-1",work.id,{
    buyerId:"buyer-1",approverSubject:"human",reviewedDigest:plan.disclosureDigest,
    ceremony:"local-sandbox-only",
  }));
  await get(commerce.sandboxFund("buyer-1",work.id));
  await get(commerce.start("buyer-1",work.id));
}
describe("Trusted remote dispatch bridge",()=>{
  it("requires exact human disclosure consent + test funding before any remote invocation",async()=>{
    let started=0;
    const executor=fakeExecutor({start:async req=>{
      started++;return {executionId:req.executionId,providerExecutionId:"job_123",status:"completed"};
    }});
    const f=await setup(executor);
    await expect(get(f.commerce.start("buyer-1",f.work.id))).rejects.toThrow();
    await get(f.commerce.sandboxFund("buyer-1",f.work.id));
    await expect(get(f.commerce.start("buyer-1",f.work.id))).rejects.toThrow();
    await expect(get(f.dispatch.advance("buyer-1",f.work.id))).rejects.toThrow();
    expect(started).toBe(0);
    await allowAfterFund(f);
    const completed=await get(f.dispatch.advance("buyer-1",f.work.id));
    expect(completed.status).toBe("finalized");
    expect(completed.request.constraints.dataClassification).toBe("public");
    expect((await get(f.commerce.preview("buyer-1",f.work.id))).state.status).toBe("submitted");
    expect((await get(f.dispatch.advance("buyer-1",f.work.id))).status).toBe("finalized");
    expect(started).toBe(1);
    expect((await get(f.dispatch.recoverable())).length).toBe(0);
  });
  it("recovers an ambiguous start without issuing a second POST",async()=>{
    let starts=0,recoveries=0;
    const executor=fakeExecutor({
      start:async()=>{starts++;throw new Error("socket closed after acceptance");},
      recover:async req=>{
        recoveries++;return recoveries<2?null:
          {executionId:req.executionId,providerExecutionId:"job_123",status:"completed"};
      },
    });
    const f=await setup(executor);
    await allow(f);
    const uncertain=await get(f.dispatch.advance("buyer-1",f.work.id));
    expect(uncertain.status).toBe("uncertain");
    time+=46_000;
    const pending=await get(f.dispatch.advance("buyer-1",f.work.id));
    expect(pending.status).toBe("uncertain");
    time+=61_000;
    const done=await get(f.dispatch.advance("buyer-1",f.work.id));
    expect(done.status).toBe("finalized");
    expect(starts).toBe(1);
    expect(recoveries).toBe(2);
  });
  it("requires pinned offering version and prohibits nonpublic work",async()=>{
    const f=await setup();
    await expect(get(f.dispatch.plan("wrong-buyer",f.work.id))).rejects.toThrow();
    const other=await get(f.marketplace.requestQuote("buyer-1",{
      offeringId:"offering:oauth-audit",scope:"Review other offering",idempotencyKey:"quote_other_123",
    }));
    const work=await get(f.marketplace.prepareWork("buyer-1",{
      quoteId:other.id,idempotencyKey:"work_other_123",
      inputs:[{name:"brief",kind:"inline",mediaType:"text/plain",data:"Some sample"}],
    }));
    await expect(get(f.dispatch.plan("buyer-1",work.id))).rejects.toThrow();
  });
  it("never promotes a returned artifact with a forbidden type",async()=>{
    const f=await setup(fakeExecutor({outputType:"text/html"}));
    await allow(f);
    const status=await get(f.dispatch.advance("buyer-1",f.work.id));
    expect(status.status).toBe("manual_review");
    expect((await get(f.commerce.preview("buyer-1",f.work.id))).state.status).toBe("external_running");
  });
});
async function allowAfterFund(f:Awaited<ReturnType<typeof setup>>){
  const plan=await get(f.dispatch.plan("buyer-1",f.work.id));
  await get(f.commerce.consentExternal("buyer-1",f.work.id,{
    buyerId:"buyer-1",approverSubject:"human",reviewedDigest:plan.disclosureDigest,
    ceremony:"local-sandbox-only",
  }));
  await get(f.commerce.start("buyer-1",f.work.id));
}
