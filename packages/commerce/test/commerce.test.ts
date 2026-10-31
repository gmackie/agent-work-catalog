import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { makeMarketplace, inMemoryMarketplaceStore } from "@awc/marketplace";
import { makeCommerce, sandboxExecutor, type WorkSnapshot, type WorkStateStore } from "../src/index.ts";

const now = ()=>Date.parse("2026-10-31T16:00:00Z");
const memoryStore=():WorkStateStore=>{
  const data=new Map<string,WorkSnapshot>();
  return {
    initialize:async(work,time)=>{
      const existing=data.get(work.id);
      if(existing)return existing;
      const initial:WorkSnapshot={id:work.id,buyerId:work.buyerId,quoteDigest:work.quoteDigest,
        status:"prepared_unfunded",version:0,attempts:0,updatedAt:time};
      data.set(work.id,initial);return initial;
    },
    get:async(buyer,id)=>{const v=data.get(id);return v?.buyerId===buyer?v:undefined;},
    cas:async(before,after)=>{
      const v=data.get(before.id);
      if(!v || v.version!==before.version || v.status!==before.status)return false;
      data.set(before.id,after);return true;
    },
    recoverable:async(time,limit)=>[...data.values()].filter(v=>v.status==="queued" ||
      (v.status==="running"&&(v.leaseUntil??Infinity)<time&&v.attempts<3))
      .slice(0,limit).map(v=>({workId:v.id,buyerId:v.buyerId})),
  };
};
async function fixture(){
  const marketplace=makeMarketplace(inMemoryMarketplaceStore(),now);
  const quote=await Effect.runPromise(marketplace.requestQuote("buyerA",{
    offeringId:"offering:modbus-report",scope:"Assess repeated HMI Modbus communication timeouts",
    idempotencyKey:"quote_test_001",
  }));
  const work=await Effect.runPromise(marketplace.prepareWork("buyerA",{
    quoteId:quote.id,idempotencyKey:"work_test_001",
    inputs:[{name:"observations",mediaType:"text/plain",kind:"inline",data:"HMI polls every 100ms"}],
  }));
  const commerce=makeCommerce(marketplace,memoryStore(),sandboxExecutor,{now,enableSandboxFunding:true});
  return {commerce,quote,work};
}
const run=<T>(effect:Effect.Effect<T,any>)=>Effect.runPromise(effect);
describe("Commercial approval, funding and deterministic execution",()=>{
  it("refuses execution before human authorization and exact funding",async()=>{
    const {commerce,quote,work}=await fixture();
    await expect(run(commerce.start("buyerA",work.id))).rejects.toThrow();
    await expect(run(commerce.approve("buyerA",work.id,{
      buyerId:"buyerA",approverSubject:"human-jordan",ceremony:"local-sandbox-only",
      reviewedDigest:"wrong-digest",
    }))).rejects.toThrow();
    const approved=await run(commerce.approve("buyerA",work.id,{
      buyerId:"buyerA",approverSubject:"human-jordan",ceremony:"local-sandbox-only",
      reviewedDigest:quote.termsDigest,
    }));
    expect(approved.status).toBe("approved");
    await expect(run(commerce.start("buyerA",work.id))).rejects.toThrow();
  });
  it("runs a funded order at most once despite duplicate queue delivery",async()=>{
    const {commerce,quote,work}=await fixture();
    await run(commerce.approve("buyerA",work.id,{
      buyerId:"buyerA",approverSubject:"human-jordan",ceremony:"local-sandbox-only",reviewedDigest:quote.termsDigest,
    }));
    const funded=await run(commerce.sandboxFund("buyerA",work.id));
    expect(funded.status).toBe("funded");
    expect((await run(commerce.start("buyerA",work.id))).enqueue).toBe(true);
    expect((await run(commerce.start("buyerA",work.id))).enqueue).toBe(false);
    const done=await run(commerce.runQueued({buyerId:"buyerA",workId:work.id}));
    expect(done.status).toBe("submitted");
    expect(done.result?.summary).toContain("DEMO ONLY");
    expect((await run(commerce.runQueued({buyerId:"buyerA",workId:work.id})).version).toBe(done.version);
    expect((await run(commerce.recoverable())).length).toBe(0);
    await expect(run(commerce.preview("buyerB",work.id))).rejects.toThrow();
  });
  it("rejects payment from another contract and wrong buyer",async()=>{
    const {commerce,quote,work}=await fixture();
    await expect(run(commerce.approve("buyerB",work.id,{
      buyerId:"buyerB",approverSubject:"human-jordan",ceremony:"local-sandbox-only",reviewedDigest:quote.termsDigest,
    }))).rejects.toThrow();
    await expect(run(commerce.sandboxFund("buyerA",work.id))).rejects.toThrow();
  });
});
