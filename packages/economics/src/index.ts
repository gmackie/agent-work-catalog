import { Context, Effect, Layer } from "effect";
import { assertMandateValid, assertAttenuated, money, type OperatingMandate } from "@awc/responsibility";

export class EconomicError extends Error {
 readonly _tag="EconomicError";
 constructor(readonly code:"insufficient_funds"|"limit_exceeded"|"conflict"|"not_found"|"inactive"|"invalid_state",
 message:string){super(message);this.name="EconomicError";}
}
export interface AccountView {
 readonly accountId:string;readonly ownerId:string;readonly currency:string;
 readonly fundedMinor:string;readonly spentMinor:string;readonly reservedMinor:string;
 readonly availableMinor:string;
}
export interface MandateView {
 readonly mandateId:string;readonly parentId?:string;
 readonly limitMinor:string;readonly spentMinor:string;readonly reservedMinor:string;
 readonly delegatedMinor:string;readonly availableMinor:string;readonly revoked:boolean;readonly closed:boolean;
}
export interface ExpenseReservation {
 readonly id:string;readonly mandateId:string;readonly accountId:string;
 readonly actionId:string;readonly idempotencyKey:string;
 readonly authorizedMinor:string;readonly chargedMinor?:string;
 readonly status:"reserved"|"captured"|"released";
}
export interface EconomicLedger {
 /** Simulation-only funding; real account funding must be supplied by trusted settlement/treasury. */
 readonly seedSimulatedAccount:(input:{accountId:string;ownerId:string;currency:string;fundedMinor:string})=>Effect.Effect<AccountView,EconomicError>;
 readonly registerMandate:(mandate:OperatingMandate)=>Effect.Effect<MandateView,EconomicError>;
 readonly reserveExpense:(request:{
  mandateId:string;actionId:string;idempotencyKey:string;maximumMinor:string;
 })=>Effect.Effect<ExpenseReservation,EconomicError>;
 readonly captureExpense:(reservationId:string,actualMinor:string)=>Effect.Effect<ExpenseReservation,EconomicError>;
 readonly releaseExpense:(reservationId:string)=>Effect.Effect<ExpenseReservation,EconomicError>;
 readonly revokeMandate:(mandateId:string)=>Effect.Effect<void,EconomicError>;
 /** Close only after reservations and descendants reconcile; return unused allowance. */
 readonly closeMandate:(mandateId:string)=>Effect.Effect<MandateView,EconomicError>;
 readonly account:(accountId:string)=>Effect.Effect<AccountView,EconomicError>;
 readonly mandate:(mandateId:string)=>Effect.Effect<MandateView,EconomicError>;
}
export class EconomicLedgerService extends Context.Service<EconomicLedgerService,EconomicLedger>()("@awc/EconomicLedger") {}
interface AccountState {ownerId:string;currency:string;funded:bigint;spent:bigint;reserved:bigint;}
interface MandateState {mandate:OperatingMandate;spent:bigint;reserved:bigint;delegated:bigint;revoked:boolean;closed:boolean;}
interface ReservationState {id:string;mandateId:string;accountId:string;actionId:string;
  idempotencyKey:string;authorized:bigint;charged?:bigint;status:"reserved"|"captured"|"released";}

/**
 * In-process, atomic, reference ledger. No wallets or actual funding.
 * All updates are synchronous so parallel Effect callers cannot interleave balance checks.
 * Production requires one serializable transaction authority across accounts and delegates.
 */
export function makeSimulatedEconomicLedger():EconomicLedger{
 const accounts=new Map<string,AccountState>();
 const grants=new Map<string,MandateState>();
 const reservations=new Map<string,ReservationState>();
 const idempotency=new Map<string,string>();
 const getAccount=(id:string):AccountState=>{
  const a=accounts.get(id);if(!a)throw new EconomicError("not_found","Account not found");return a;
 };
 const getGrant=(id:string):MandateState=>{
  const m=grants.get(id);if(!m)throw new EconomicError("not_found","Mandate not found");return m;
 };
 const accountView=(id:string):AccountView=>{
  const a=getAccount(id);return {accountId:id,ownerId:a.ownerId,currency:a.currency,
   fundedMinor:String(a.funded),spentMinor:String(a.spent),reservedMinor:String(a.reserved),
   availableMinor:String(a.funded-a.spent-a.reserved)};
 };
 const grantView=(id:string):MandateView=>{
  const m=getGrant(id);const limit=money(m.mandate.economics.maxTotalMinor);
  return {mandateId:id,...(m.mandate.parentId?{parentId:m.mandate.parentId}:{}),
   limitMinor:String(limit),spentMinor:String(m.spent),reservedMinor:String(m.reserved),
   delegatedMinor:String(m.delegated),
   availableMinor:String(limit-m.spent-m.reserved-m.delegated),revoked:m.revoked,closed:m.closed};
 };
 const reservationView=(r:ReservationState):ExpenseReservation=>({
  id:r.id,mandateId:r.mandateId,accountId:r.accountId,actionId:r.actionId,
  idempotencyKey:r.idempotencyKey,authorizedMinor:String(r.authorized),
  ...(r.charged===undefined?{}:{chargedMinor:String(r.charged)}),status:r.status,
 });
 const perform=<T>(fn:()=>T):Effect.Effect<T,EconomicError>=>Effect.try({
  try:fn,catch:e=>e instanceof EconomicError?e:new EconomicError("invalid_state","Economic ledger rejected operation"),
 });
 const descendants=(id:string):boolean=>{
  let cur=grants.get(id),steps=0;
  while(cur?.mandate.parentId){
   if(++steps>32)throw new EconomicError("invalid_state","Mandate graph cycle");
   const parent=getGrant(cur.mandate.parentId);
   if(parent.revoked||parent.closed)return true;
   cur=parent;
  }
  return false;
 };
 return {
  seedSimulatedAccount:input=>perform(()=>{
   const funded=money(input.fundedMinor);
   if(!input.accountId||!input.ownerId||!/^[A-Z]{3}$/.test(input.currency)||
      accounts.has(input.accountId))throw new EconomicError("conflict","Invalid or duplicate simulation account");
   accounts.set(input.accountId,{ownerId:input.ownerId,currency:input.currency,funded,spent:0n,reserved:0n});
   return accountView(input.accountId);
  }),
  registerMandate:mandate=>perform(()=>{
   assertMandateValid(mandate);
   const old=grants.get(mandate.id);
   if(old)throw new EconomicError("conflict","Mandate already registered");
   const account=getAccount(mandate.economics.accountId);
   if(account.ownerId!==mandate.principalId || account.currency!==mandate.economics.currency){
    throw new EconomicError("invalid_state","Mandate account owner/currency mismatch");
   }
   const m:MandateState={mandate,spent:0n,reserved:0n,delegated:0n,revoked:false,closed:false};
   if(mandate.parentId){
    const parent=getGrant(mandate.parentId);
    if(parent.revoked||parent.closed||descendants(parent.mandate.id))throw new EconomicError("inactive","Parent authority is revoked");
    assertAttenuated(mandate,parent.mandate);
    const p=money(parent.mandate.economics.maxTotalMinor);
    const amount=money(mandate.economics.maxTotalMinor);
    if(parent.spent+parent.reserved+parent.delegated+amount>p){
      throw new EconomicError("limit_exceeded","Sibling delegations overcommit shared parent authority");
    }
    parent.delegated+=amount;
   }
   grants.set(mandate.id,m);return grantView(mandate.id);
  }),
  reserveExpense:req=>perform(()=>{
   const g=getGrant(req.mandateId);
   if(g.revoked||g.closed||descendants(req.mandateId))throw new EconomicError("inactive","Mandate revoked");
   const amount=money(req.maximumMinor),perAction=money(g.mandate.economics.maxPerActionMinor);
   if(amount<=0n || amount>perAction)throw new EconomicError("limit_exceeded","Action exceeds spending mandate");
   if(!req.actionId||!req.idempotencyKey)throw new EconomicError("invalid_state","Missing execution reference");
   const key=req.mandateId+":"+req.idempotencyKey;
   const prior=idempotency.get(key);
   if(prior){
    const previous=reservations.get(prior)!;
    if(previous.actionId!==req.actionId||previous.authorized!==amount){
      throw new EconomicError("conflict","Idempotency key reused with different terms");
    }
    return reservationView(previous);
   }
   const limit=money(g.mandate.economics.maxTotalMinor);
   if(g.spent+g.reserved+g.delegated+amount>limit){
    throw new EconomicError("limit_exceeded","Mandate budget is committed to other work");
   }
   const a=getAccount(g.mandate.economics.accountId);
   if(a.funded-a.spent-a.reserved<amount)throw new EconomicError("insufficient_funds","Funding unavailable despite mandate");
   const record:ReservationState={id:"reservation:"+crypto.randomUUID(),mandateId:req.mandateId,
    accountId:g.mandate.economics.accountId,actionId:req.actionId,
    idempotencyKey:req.idempotencyKey,authorized:amount,status:"reserved"};
   g.reserved+=amount;a.reserved+=amount;
   reservations.set(record.id,record);idempotency.set(key,record.id);
   return reservationView(record);
  }),
  captureExpense:(id,actualMinor)=>perform(()=>{
   const r=reservations.get(id);
   if(!r)throw new EconomicError("not_found","Unknown reservation");
   const actual=money(actualMinor);
   if(r.status==="captured"&&r.charged===actual)return reservationView(r);
   if(r.status!=="reserved"||actual>r.authorized)throw new EconomicError("invalid_state","Cannot capture beyond reservation or twice");
   const g=getGrant(r.mandateId),a=getAccount(r.accountId);
   g.reserved-=r.authorized;a.reserved-=r.authorized;
   g.spent+=actual;a.spent+=actual;
   r.status="captured";r.charged=actual;return reservationView(r);
  }),
  releaseExpense:id=>perform(()=>{
   const r=reservations.get(id);
   if(!r)throw new EconomicError("not_found","Unknown reservation");
   if(r.status==="released")return reservationView(r);
   if(r.status!=="reserved")throw new EconomicError("invalid_state","Captured expense cannot be undone by releasing reservation");
   const g=getGrant(r.mandateId),a=getAccount(r.accountId);
   g.reserved-=r.authorized;a.reserved-=r.authorized;
   r.status="released";return reservationView(r);
  }),
  revokeMandate:id=>perform(()=>{
   const g=getGrant(id);g.revoked=true;
  }),
  closeMandate:id=>perform(()=>{
   const g=getGrant(id);
   if(g.closed)return grantView(id);
   if(g.reserved!==0n || g.delegated!==0n){
    throw new EconomicError("invalid_state","Cannot close while expense reservations or child allowances remain");
   }
   // Closing a child releases only UNUSED allowance to the parent, while rolling
   // captured expense into the parent's consumed budget. Account cash is unchanged.
   if(g.mandate.parentId){
    const parent=getGrant(g.mandate.parentId);
    const allowance=money(g.mandate.economics.maxTotalMinor);
    if(parent.delegated<allowance)throw new EconomicError("invalid_state","Parent allocation inconsistent");
    parent.delegated-=allowance;
    parent.spent+=g.spent;
   }
   g.closed=true;g.revoked=true;
   return grantView(id);
  }),
  account:id=>perform(()=>accountView(id)),
  mandate:id=>perform(()=>grantView(id)),
 };
}
export const simulatedEconomicLedgerLayer=()=>Layer.succeed(EconomicLedgerService,makeSimulatedEconomicLedger());
