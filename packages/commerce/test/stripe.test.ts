import { describe,expect,it } from "vitest";
import Stripe from "stripe";
import type { PreparedWork, Quote } from "@awc/marketplace";
import { stripeTestCheckout } from "../src/stripe.ts";

const quote={
  id:"quote_1",buyerId:"buyer1",offeringId:"offering:modbus-report",
  offeringVersion:"1",taskTypeId:"task:modbus-diagnostics",scope:"Synthetic diagnostic report",
  price:{currency:"USD",minorUnits:"3500"},requestDigest:"a".repeat(64),
  termsDigest:"b".repeat(64),idempotencyKey:"quote_test_001",createdAt:"2026-10-31T00:00:00Z",
  expiresAt:"2026-11-01T00:00:00Z",state:"quoted",
} as const satisfies Quote;
const work={
  id:"work_123",buyerId:"buyer1",quoteId:"quote_1",offeringId:quote.offeringId,
  taskTypeId:quote.taskTypeId,quoteDigest:quote.termsDigest,inputDigest:"c".repeat(64),
  inputs:[],idempotencyKey:"work_test_001",state:"prepared_unfunded",
  createdAt:"2026-10-31T00:00:00Z",
  funding:{status:"not_authorized",amount:quote.price},
} as const satisfies PreparedWork;
const session={
  id:"cs_test_123",url:"https://checkout.stripe.com/test",
  livemode:false,mode:"payment",status:"complete",payment_status:"paid",
  currency:"usd",amount_total:3500,payment_intent:"pi_test_123",
  client_reference_id:work.id,
  metadata:{
    awc_work_id:work.id,awc_buyer_id:work.buyerId,
    awc_quote_digest:work.quoteDigest,awc_offering_id:work.offeringId,
  },
};
describe("Stripe TEST Checkout verification",()=>{
  const client=(retrieve=()=>session)=>({
    checkout:{sessions:{
      create:async()=>session,retrieve:async()=>retrieve(),
    }},
  } as unknown as Stripe);
  it("binds checkout to exact immutable amount, buyer, work and quote",async()=>{
    const rail=stripeTestCheckout(client(),"http://localhost:8787");
    const created=await rail.create(work,quote);
    expect(created.sessionId).toBe(session.id);
    const funding=await rail.verify(created.sessionId,work,quote);
    expect(funding.quoteDigest).toBe(quote.termsDigest);
    expect(funding.minorUnits).toBe("3500");
    expect(funding.rail).toBe("stripe-test");
  });
  it("rejects wrong amount, mismatched quote and live-mode checkout",async()=>{
    const tooLittle=stripeTestCheckout(client(()=>({...session,amount_total:3400})),"https://awc.example");
    await expect(tooLittle.verify(session.id,work,quote)).rejects.toThrow();
    const swapped=stripeTestCheckout(client(()=>({...session,metadata:{...session.metadata,awc_quote_digest:"evil"}})),"https://awc.example");
    await expect(swapped.verify(session.id,work,quote)).rejects.toThrow();
    const live=stripeTestCheckout(client(()=>({...session,livemode:true})),"https://awc.example");
    await expect(live.verify(session.id,work,quote)).rejects.toThrow();
  });
});
