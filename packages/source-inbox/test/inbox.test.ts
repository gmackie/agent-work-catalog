import {describe,expect,it} from "vitest";
import {inMemorySourceInbox} from "../src/index.ts";
import type {WorkOpportunity} from "@awc/adapter-sdk";
const item:WorkOpportunity={
  schemaVersion:"awc.opportunity/v1",id:"github:123:456",eventId:"aabbccdd-1122-3344-5566-778899aabbcc",
  title:"Review authentication",description:"Return a finding report",observedAt:"2026-10-31T18:00:00Z",
  status:"open",external:{sourceId:"github.source",externalId:"github:123:456",
    originUrl:"https://github.com/testorg/fixture/issues/7",installationId:"987",repositoryId:"123",issueNumber:7},
};
describe("Source inbox",()=>{
  it("deduplicates webhook event IDs and scopes opportunities to the buyer",async()=>{
    const s=inMemorySourceInbox();
    expect((await s.record("buyerA",item,"a".repeat(64))).duplicate).toBe(false);
    expect((await s.record("buyerA",item,"a".repeat(64))).duplicate).toBe(true);
    expect(await s.list("buyerB",10)).toHaveLength(0);
    expect(await s.list("buyerA",10)).toHaveLength(1);
    expect(await s.get("buyerB",item.id)).toBeUndefined();
  });
  it("rejects reused delivery ID with different signed bytes",async()=>{
    const s=inMemorySourceInbox();
    await s.record("buyerA",item,"a".repeat(64));
    await expect(s.record("buyerA",item,"b".repeat(64))).rejects.toThrow();
  });
});
