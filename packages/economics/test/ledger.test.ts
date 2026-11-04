import { describe,expect,it } from "vitest";
import { Effect } from "effect";
import { makeSimulatedEconomicLedger } from "../src/index.ts";
import type { OperatingMandate } from "@awc/responsibility";

const mandate=(id:string,parent?:OperatingMandate,limit="9000"):OperatingMandate=>({
 schemaVersion:"awc.operating-mandate/v1",id,...(parent?{parentId:parent.id}:{}),
 principalId:"org:owner",accountablePartyId:"org:owner",
 issuerId:parent?.delegateId??"org:owner",delegateId:id==="root"?"agent:manager":id,
 operationId:"operation:cloud",issuedAt:"2026-10-31T00:00:00Z",
 validFrom:"2026-10-31T00:00:00Z",
 expiresAt:parent?"2026-11-15T00:00:00Z":"2026-11-30T00:00:00Z",
 scope:{entityIds:["service:a"],actions:["capacity.acquire"],
 maximumRisk:"commercial",maximumDataClassification:"internal",deniedActions:[],
 approvalActions:[],maximumObservationAgeMs:60_000,remainingDelegations:parent?0:2},
 economics:{accountId:"account:a",currency:"USD",
  maxTotalMinor:limit,maxPerActionMinor:parent?"3500":"5000"},
 obligations:[],
});
const run=<T>(e:Effect.Effect<T,any>)=>Effect.runPromise(e);
async function setup(funds="10000"){
 const l=makeSimulatedEconomicLedger();
 await run(l.seedSimulatedAccount({accountId:"account:a",ownerId:"org:owner",currency:"USD",fundedMinor:funds}));
 const root=mandate("root");await run(l.registerMandate(root));return {l,root};
}
describe("simulated economic authority ledger",()=>{
 it("separates permission to spend from available funded assets",async()=>{
  const {l}=await setup("100");
  await expect(run(l.reserveExpense({mandateId:"root",actionId:"job1",idempotencyKey:"x",maximumMinor:"300"})))
    .rejects.toMatchObject({code:"insufficient_funds"});
 });
 it("prevents concurrent sibling subdelegations from multiplying the parent's ceiling",async()=>{
  const {l,root}=await setup();
  await run(l.registerMandate(mandate("child1",root,"6000")));
  const results=await Promise.allSettled([
   run(l.registerMandate(mandate("child2",root,"4000"))),
   run(l.registerMandate(mandate("child3",root,"4000"))),
  ]);
  expect(results.filter(x=>x.status==="fulfilled")).toHaveLength(0);
  const parent=await run(l.mandate("root"));expect(parent.delegatedMinor).toBe("6000");
  const res=await run(l.reserveExpense({mandateId:"root",actionId:"self",idempotencyKey:"root-self",maximumMinor:"3000"}));
  expect(res.status).toBe("reserved");
  await expect(run(l.reserveExpense({mandateId:"root",actionId:"other",idempotencyKey:"root-other",maximumMinor:"1000"})))
    .rejects.toMatchObject({code:"limit_exceeded"});
 });
 it("serializes concurrent reservations, prevents double spend, and settles exact usage",async()=>{
  const {l}=await setup("5000");
  const req=(id:string)=>run(l.reserveExpense({mandateId:"root",actionId:id,idempotencyKey:id,maximumMinor:"3500"}));
  const results=await Promise.allSettled([req("task1"),req("task2")]);
  expect(results.filter(x=>x.status==="fulfilled")).toHaveLength(1);
  const r=results.find(x=>x.status==="fulfilled") as PromiseFulfilledResult<Awaited<ReturnType<typeof req>>>;
  const duplicate=await run(l.reserveExpense({mandateId:"root",actionId:r.value.actionId,
    idempotencyKey:r.value.idempotencyKey,maximumMinor:"3500"}));
  expect(duplicate.id).toBe(r.value.id);
  await expect(run(l.reserveExpense({mandateId:"root",actionId:"swapped",idempotencyKey:r.value.idempotencyKey,maximumMinor:"3500"})))
    .rejects.toMatchObject({code:"conflict"});
  await run(l.captureExpense(r.value.id,"2500"));
  const account=await run(l.account("account:a"));
  expect(account.spentMinor).toBe("2500");
  expect(account.availableMinor).toBe("2500");
  await expect(run(l.releaseExpense(r.value.id))).rejects.toThrow();
 });
 it("handles refund of unused reservations without creating value",async()=>{
  const {l}=await setup("5000");
  const r=await run(l.reserveExpense({mandateId:"root",actionId:"task",idempotencyKey:"key",maximumMinor:"3500"}));
  await run(l.releaseExpense(r.id));
  expect((await run(l.account("account:a"))).availableMinor).toBe("5000");
  await expect(run(l.captureExpense(r.id,"100"))).rejects.toThrow();
 });

 it("reconciles captured child spend into parent on close without minting new authority",async()=>{
  const {l,root}=await setup();
  const child=mandate("buyer",root,"4000");await run(l.registerMandate(child));
  const reservation=await run(l.reserveExpense({mandateId:child.id,actionId:"a",idempotencyKey:"a",maximumMinor:"1000"}));
  await expect(run(l.closeMandate(child.id))).rejects.toMatchObject({code:"invalid_state"});
  await run(l.captureExpense(reservation.id,"750"));
  const closed=await run(l.closeMandate(child.id));
  expect(closed.closed).toBe(true);
  const parent=await run(l.mandate(root.id));
  expect(parent.spentMinor).toBe("750");
  expect(parent.delegatedMinor).toBe("0");
  expect(parent.availableMinor).toBe("8250");
  expect((await run(l.account("account:a"))).spentMinor).toBe("750");
  await expect(run(l.reserveExpense({mandateId:child.id,actionId:"b",idempotencyKey:"b",maximumMinor:"100"})))
    .rejects.toMatchObject({code:"inactive"});
 });

 it("revoke cascades to descendant actions and preserves existing expenses",async()=>{
  const {l,root}=await setup();
  const child=mandate("buyer",root,"4000");await run(l.registerMandate(child));
  const spent=await run(l.reserveExpense({mandateId:child.id,actionId:"order",idempotencyKey:"reserved",maximumMinor:"1000"}));
  await run(l.revokeMandate(root.id));
  await expect(run(l.reserveExpense({mandateId:child.id,actionId:"new",idempotencyKey:"new",maximumMinor:"100"})))
    .rejects.toMatchObject({code:"inactive"});
  await run(l.releaseExpense(spent.id));
  expect((await run(l.account("account:a"))).availableMinor).toBe("10000");
  const closed=await run(l.closeMandate(child.id));
  expect(closed.closed).toBe(true);
  expect((await run(l.mandate(root.id))).delegatedMinor).toBe("0");
 });
});
