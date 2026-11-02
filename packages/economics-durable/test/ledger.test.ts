import { describe,expect,it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import type { OperatingMandate } from "@awc/responsibility";
import { makeDurableAccountLedger,type AtomicSqlStorage } from "../src/index.ts";

const NOW=Date.parse("2026-11-01T18:00:00Z");
function sqliteFixture(){
 const database=new DatabaseSync(":memory:");
 const storage:AtomicSqlStorage={
  sql:{exec<T extends Record<string,unknown>>(query:string,...params:(string|number|null)[]){
   const statement=database.prepare(query);
   const read=/^\s*SELECT\b/i.test(query);
   const rows=read?statement.all(...params):(
     statement.run(...params),[]);
   return {toArray:()=>rows as T[]};
  }},
  transactionSync:fn=>{
   database.exec("BEGIN IMMEDIATE");
   try{const result=fn();database.exec("COMMIT");return result;}
   catch(error){database.exec("ROLLBACK");throw error;}
  },
 };
 const ledger=makeDurableAccountLedger(storage,()=>NOW);
 return {database,ledger};
}
function mandate(id:string,parent?:OperatingMandate,limit="9000"):OperatingMandate{
 return {
  schemaVersion:"awc.operating-mandate/v1",id,
  ...(parent?{parentId:parent.id}:{}),
  principalId:"org:owner",delegateId:id==="root"?"agent:manager":id,
  accountablePartyId:"org:owner",issuerId:parent?.delegateId??"org:owner",
  operationId:"operation:cloud",issuedAt:"2026-10-01T00:00:00Z",
  validFrom:"2026-10-01T00:00:00Z",
  expiresAt:parent?"2026-11-20T00:00:00Z":"2026-11-30T00:00:00Z",
  scope:{entityIds:["cloud:a"],actions:["capacity.acquire"],
   maximumRisk:"commercial",maximumDataClassification:"internal",
   deniedActions:[],approvalActions:[],maximumObservationAgeMs:60000,
   remainingDelegations:parent?0:2},
  economics:{accountId:"account:a",currency:"USD",
   maxTotalMinor:limit,maxPerActionMinor:parent?"3500":"5000"},obligations:[],
 };
}
describe("SQLite-backed transactional account authority",()=>{
 it("cannot spend with merely a budget; actual funds require a trusted settlement source",()=>{
  const {database,ledger}=sqliteFixture();
  try{
   ledger.initialize("account:a","org:owner","USD");
   ledger.registerMandate(mandate("root"));
   expect(()=>ledger.reserveExpense({mandateId:"root",actionId:"a",
     idempotencyKey:"idem-a",maximumMinor:"1000"})).toThrow();
   ledger.recordVerifiedFunding("verified:receipt:1","1000");
   expect(ledger.account().availableMinor).toBe("1000");
  }finally{database.close();}
 });
 it("atomically prevents parallel oversubscription and preserves idempotence",async()=>{
  const {database,ledger}=sqliteFixture();
  try{
   ledger.initialize("account:a","org:owner","USD");
   ledger.recordVerifiedFunding("verified:receipt:1","5000");
   ledger.registerMandate(mandate("root"));
   const reserve=(id:string)=>Promise.resolve().then(()=>ledger.reserveExpense({
    mandateId:"root",actionId:id,idempotencyKey:id,maximumMinor:"3500"
   }));
   const outcomes=await Promise.allSettled([reserve("a"),reserve("b")]);
   expect(outcomes.filter(x=>x.status==="fulfilled")).toHaveLength(1);
   const first=outcomes.find(x=>x.status==="fulfilled") as PromiseFulfilledResult<
     Awaited<ReturnType<typeof reserve>>>;
   const again=ledger.reserveExpense({mandateId:"root",
    actionId:first.value.actionId,idempotencyKey:first.value.idempotencyKey,maximumMinor:"3500"});
   expect(again.id).toBe(first.value.id);
   expect(()=>ledger.reserveExpense({mandateId:"root",actionId:"swapped",
    idempotencyKey:first.value.idempotencyKey,maximumMinor:"3500"})).toThrow();
   const captured=ledger.captureExpense(first.value.id,"2500");
   expect(captured.capturedMinor).toBe("2500");
   expect(ledger.account().availableMinor).toBe("2500");
   expect(ledger.captureExpense(first.value.id,"2500").id).toBe(first.value.id);
   expect(()=>ledger.releaseExpense(first.value.id)).toThrow();
  }finally{database.close();}
 });
 it("prevents sibling mandates from multiplying budgets, handles revocation, and reconciles child closure",()=>{
  const {database,ledger}=sqliteFixture();
  try{
   ledger.initialize("account:a","org:owner","USD");
   ledger.recordVerifiedFunding("verified:receipt:1","10000");
   const root=mandate("root");
   ledger.registerMandate(root);
   const child=mandate("child",root,"6000");
   ledger.registerMandate(child);
   expect(()=>ledger.registerMandate(mandate("sibling",root,"4000"))).not.toThrow();
   expect(()=>ledger.registerMandate(mandate("oversubscribed",root,"1"))).toThrow();
   expect(()=>ledger.reserveExpense({mandateId:"root",actionId:"parent",idempotencyKey:"p",
    maximumMinor:"100"})).toThrow();
   const r=ledger.reserveExpense({mandateId:child.id,actionId:"task",idempotencyKey:"r",
    maximumMinor:"1000"});
   ledger.revokeMandate(root.id);
   expect(()=>ledger.reserveExpense({mandateId:child.id,actionId:"new",idempotencyKey:"new",
    maximumMinor:"100"})).toThrow();
   ledger.captureExpense(r.id,"750");
   expect(()=>ledger.closeMandate(child.id)).not.toThrow();
   expect(ledger.mandate(root.id).spentMinor).toBe("750");
   expect(ledger.mandate(root.id).delegatedMinor).toBe("4000");
   expect(ledger.account().spentMinor).toBe("750");
  }finally{database.close();}
 });
 it("rolls back a multi-statement transaction on invalid reallocation and prevents changed funding references",()=>{
  const {database,ledger}=sqliteFixture();
  try{
   ledger.initialize("account:a","org:owner","USD");
   ledger.recordVerifiedFunding("verified:receipt:1","2500");
   expect(()=>ledger.recordVerifiedFunding("verified:receipt:1","3500")).toThrow();
   expect(ledger.account().fundedMinor).toBe("2500");
   const root=mandate("root");ledger.registerMandate(root);
   expect(()=>ledger.registerMandate({...root,id:"fake",parentId:"root",
     issuerId:"agent:manager",delegateId:"agent:fake",
     economics:{...root.economics,maxTotalMinor:"10000"}})).toThrow();
   expect(ledger.mandate("root").delegatedMinor).toBe("0");
  }finally{database.close();}
 });
});
