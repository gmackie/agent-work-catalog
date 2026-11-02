import { assertAttenuated,assertMandateValid } from "@awc/responsibility";
import type { OperatingMandate } from "@awc/responsibility";

/**
 * SQLite-backed Durable Object compatible storage. One instance MUST own one
 * economic account and the entire descendant mandate tree for that account.
 */
export interface SqlCursor<T> {toArray():T[]}
export interface SqlExecutor {
  exec<T extends Record<string,unknown>>(sql:string,...bindings:(string|number|null)[]):SqlCursor<T>;
}
export interface AtomicSqlStorage {
  readonly sql:SqlExecutor;
  transactionSync<T>(run:()=>T):T;
}
export class TreasuryError extends Error {
  readonly _tag="TreasuryError";
  constructor(readonly code:"not_found"|"conflict"|"revoked"|"limit_exceeded"|
    "insufficient_funds"|"invalid_state"|"invalid_input",message:string) {
    super(message);this.name="TreasuryError";
  }
}
export interface DurableAccount {
  readonly accountId:string;readonly ownerId:string;readonly currency:string;
  readonly fundedMinor:string;readonly spentMinor:string;readonly reservedMinor:string;
  readonly availableMinor:string;
}
export interface DurableMandate {
  readonly mandateId:string;readonly limitMinor:string;readonly spentMinor:string;
  readonly reservedMinor:string;readonly delegatedMinor:string;readonly availableMinor:string;
  readonly revoked:boolean;readonly closed:boolean;
}
export interface DurableReservation {
  readonly id:string;readonly mandateId:string;readonly actionId:string;
  readonly idempotencyKey:string;readonly maximumMinor:string;
  readonly capturedMinor?:string;
  readonly state:"reserved"|"captured"|"released";
}
type AccountRow={account_id:string;owner_id:string;currency:string;
  funded_minor:string;spent_minor:string;reserved_minor:string};
type MandateRow={id:string;parent_id:string|null;payload:string;spent_minor:string;
  reserved_minor:string;delegated_minor:string;revoked:number;closed:number};
type ReservationRow={id:string;mandate_id:string;action_id:string;idem_key:string;
  max_minor:string;captured_minor:string|null;state:string};
type FundingRow={reference:string;amount_minor:string};
const MAX=10n**18n;
function amt(input:string):bigint{
  if(!/^(0|[1-9][0-9]*)$/.test(input)||BigInt(input)>MAX)throw new TreasuryError("invalid_input","Invalid integer minor-units amount");
  return BigInt(input);
}
function selectOne<T extends Record<string,unknown>>(
  db:SqlExecutor,sql:string,...params:(string|number|null)[]
):T|undefined {return db.exec<T>(sql,...params).toArray()[0];}
function parseMandate(row:MandateRow):OperatingMandate{
  try {
    const m=JSON.parse(row.payload) as OperatingMandate;
    assertMandateValid(m);
    if(m.id!==row.id||m.parentId!==(row.parent_id??undefined))throw Error("Identity mismatch");
    return m;
  }catch{throw new TreasuryError("invalid_state","Stored mandate corrupted");}
}
/**
 * Initialize the schema once in the DO constructor. Cloudflare's transactionSync
 * provides real SQLite atomicity. No external provider calls inside transactions.
 */
export function makeDurableAccountLedger(storage:AtomicSqlStorage,now:()=>number=Date.now){
  const sql=storage.sql;
  for(const statement of [
    "CREATE TABLE IF NOT EXISTS awc_account(account_id TEXT PRIMARY KEY,owner_id TEXT NOT NULL,currency TEXT NOT NULL,funded_minor TEXT NOT NULL,spent_minor TEXT NOT NULL,reserved_minor TEXT NOT NULL)",
    "CREATE TABLE IF NOT EXISTS awc_mandate(id TEXT PRIMARY KEY,parent_id TEXT,payload TEXT NOT NULL,spent_minor TEXT NOT NULL,reserved_minor TEXT NOT NULL,delegated_minor TEXT NOT NULL,revoked INTEGER NOT NULL DEFAULT 0,closed INTEGER NOT NULL DEFAULT 0)",
    "CREATE TABLE IF NOT EXISTS awc_expense(id TEXT PRIMARY KEY,mandate_id TEXT NOT NULL,action_id TEXT NOT NULL,idem_key TEXT NOT NULL,max_minor TEXT NOT NULL,captured_minor TEXT,state TEXT NOT NULL,UNIQUE(mandate_id,idem_key))",
    "CREATE TABLE IF NOT EXISTS awc_funding(reference TEXT PRIMARY KEY,amount_minor TEXT NOT NULL)",
    "CREATE TABLE IF NOT EXISTS awc_journal(sequence INTEGER PRIMARY KEY AUTOINCREMENT,kind TEXT NOT NULL,ref TEXT NOT NULL,amount_minor TEXT NOT NULL)"
  ])sql.exec(statement);
  const getAccount=():AccountRow=>{
    const a=selectOne<AccountRow>(sql,"SELECT account_id,owner_id,currency,funded_minor,spent_minor,reserved_minor FROM awc_account LIMIT 1");
    if(!a)throw new TreasuryError("not_found","Account is not initialized");
    return a;
  };
  const getMandate=(id:string):MandateRow=>{
    const m=selectOne<MandateRow>(sql,
      "SELECT id,parent_id,payload,spent_minor,reserved_minor,delegated_minor,revoked,closed FROM awc_mandate WHERE id=?",id);
    if(!m)throw new TreasuryError("not_found","Mandate missing");
    return m;
  };
  const accountView=():DurableAccount=>{
    const a=getAccount();const available=amt(a.funded_minor)-amt(a.spent_minor)-amt(a.reserved_minor);
    if(available<0n)throw new TreasuryError("invalid_state","Account became overdrawn");
    return {accountId:a.account_id,ownerId:a.owner_id,currency:a.currency,
      fundedMinor:a.funded_minor,spentMinor:a.spent_minor,reservedMinor:a.reserved_minor,
      availableMinor:String(available)};
  };
  const mandateView=(id:string):DurableMandate=>{
    const row=getMandate(id),m=parseMandate(row);
    const allowance=amt(m.economics.maxTotalMinor)-amt(row.spent_minor)-
      amt(row.reserved_minor)-amt(row.delegated_minor);
    if(allowance<0n)throw new TreasuryError("invalid_state","Mandate budget became overcommitted");
    return {mandateId:id,limitMinor:m.economics.maxTotalMinor,spentMinor:row.spent_minor,
      reservedMinor:row.reserved_minor,delegatedMinor:row.delegated_minor,
      availableMinor:String(allowance),revoked:row.revoked===1,closed:row.closed===1};
  };
  const reservationView=(row:ReservationRow):DurableReservation=>({
    id:row.id,mandateId:row.mandate_id,actionId:row.action_id,
    idempotencyKey:row.idem_key,maximumMinor:row.max_minor,
    ...(row.captured_minor===null?{}:{capturedMinor:row.captured_minor}),
    state:row.state as DurableReservation["state"],
  });
  const authorizeChain=(id:string):MandateRow=>{
    const first=getMandate(id),seen=new Set<string>();let current:MandateRow|undefined=first;
    let depth=0;
    const timestamp=now();
    while(current){
      if(++depth>32||seen.has(current.id))throw new TreasuryError("invalid_state","Cyclic/deep mandate");
      seen.add(current.id);
      const m=parseMandate(current);
      if(current.closed||current.revoked||timestamp<Date.parse(m.validFrom)||
         timestamp>=Date.parse(m.expiresAt)){
        throw new TreasuryError("revoked","Mandate is revoked, expired or not active");
      }
      if(current.parent_id){
        const parent=getMandate(current.parent_id);
        const parentMandate=parseMandate(parent);
        assertAttenuated(m,parentMandate);
        current=parent;
      }else{
        if(m.issuerId!==m.principalId)throw new TreasuryError("invalid_state","Root issuer not verified");
        current=undefined;
      }
    }
    return first;
  };
  const write=(kind:string,ref:string,amount:bigint)=>{
    sql.exec("INSERT INTO awc_journal(kind,ref,amount_minor) VALUES(?,?,?)",kind,ref,String(amount));
  };
  const exactReservation=(id:string):ReservationRow=>{
    const row=selectOne<ReservationRow>(sql,
      "SELECT id,mandate_id,action_id,idem_key,max_minor,captured_minor,state FROM awc_expense WHERE id=?",id);
    if(!row)throw new TreasuryError("not_found","Expense reservation not found");
    return row;
  };
  return {
    /** No initial balance is allowed; only independently verified settlement may fund. */
    initialize(accountId:string,ownerId:string,currency:string):DurableAccount{
      return storage.transactionSync(()=>{
        if(!accountId||!ownerId||!/^[A-Z]{3}$/.test(currency))throw new TreasuryError("invalid_input","Bad account identity");
        const existing=sql.exec<AccountRow>("SELECT * FROM awc_account LIMIT 1").toArray()[0];
        if(existing){
          if(existing.account_id!==accountId||existing.owner_id!==ownerId||existing.currency!==currency){
            throw new TreasuryError("conflict","This Durable Object belongs to another account");
          }
          return accountView();
        }
        sql.exec("INSERT INTO awc_account VALUES (?,?,?,?,?,?)",accountId,ownerId,currency,"0","0","0");
        write("account-opened",accountId,0n);
        return accountView();
      });
    },
    /**
     * TRUSTED TREASURY-ONLY PORT: upstream payment signer/processor MUST authenticate,
     * deduplicate and confirm final settlement before calling. Never expose publicly.
     */
    recordVerifiedFunding(reference:string,amountMinor:string):DurableAccount{
      return storage.transactionSync(()=>{
        if(!reference||reference.length>256)throw new TreasuryError("invalid_input","Funding reference invalid");
        const amount=amt(amountMinor);if(amount===0n)throw new TreasuryError("invalid_input","Zero funding not allowed");
        const a=getAccount();
        const past=selectOne<FundingRow>(sql,
          "SELECT reference,amount_minor FROM awc_funding WHERE reference=?",reference);
        if(past){
          if(past.amount_minor!==amountMinor)throw new TreasuryError("conflict","Funding reference reused with different value");
          return accountView();
        }
        if(amt(a.funded_minor)+amount>MAX)throw new TreasuryError("limit_exceeded","Account maximum exceeded");
        sql.exec("INSERT INTO awc_funding VALUES (?,?)",reference,amountMinor);
        sql.exec("UPDATE awc_account SET funded_minor=? WHERE account_id=?",
          String(amt(a.funded_minor)+amount),a.account_id);
        write("trusted-funding",reference,amount);
        return accountView();
      });
    },
    registerMandate(m:OperatingMandate):DurableMandate{
      return storage.transactionSync(()=>{
        assertMandateValid(m);
        const a=getAccount();
        if(m.economics.accountId!==a.account_id||m.principalId!==a.owner_id||
          m.economics.currency!==a.currency)throw new TreasuryError("invalid_input","Mandate account mismatch");
        const old=selectOne<MandateRow>(sql,"SELECT * FROM awc_mandate WHERE id=?",m.id);
        if(old)throw new TreasuryError("conflict","Mandate already registered");
        if(m.parentId){
          const parent=authorizeChain(m.parentId),p=parseMandate(parent);
          assertAttenuated(m,p);
          const quantity=amt(m.economics.maxTotalMinor);
          const available=amt(p.economics.maxTotalMinor)-amt(parent.spent_minor)-
            amt(parent.reserved_minor)-amt(parent.delegated_minor);
          if(quantity>available)throw new TreasuryError("limit_exceeded","Sibling mandate allocations exceed parent ceiling");
          sql.exec("UPDATE awc_mandate SET delegated_minor=? WHERE id=?",
            String(amt(parent.delegated_minor)+quantity),p.id);
        }else if(m.issuerId!==m.principalId){
          throw new TreasuryError("invalid_input","Root mandates must be registered by the named principal");
        }
        sql.exec("INSERT INTO awc_mandate VALUES (?,?,?,?,?,?,?,?)",
          m.id,m.parentId??null,JSON.stringify(m),"0","0","0",0,0);
        write("mandate-registered",m.id,amt(m.economics.maxTotalMinor));
        return mandateView(m.id);
      });
    },
    reserveExpense(input:{
      mandateId:string;actionId:string;idempotencyKey:string;maximumMinor:string;
    }):DurableReservation {
      return storage.transactionSync(()=>{
        const g=authorizeChain(input.mandateId),m=parseMandate(g);
        if(!input.actionId||!input.idempotencyKey||input.idempotencyKey.length>150){
          throw new TreasuryError("invalid_input","Missing expense identity");
        }
        const amount=amt(input.maximumMinor);
        if(amount===0n||amount>amt(m.economics.maxPerActionMinor)){
          throw new TreasuryError("limit_exceeded","Per-action ceiling exceeded");
        }
        const existing=selectOne<ReservationRow>(sql,"SELECT * FROM awc_expense WHERE mandate_id=? AND idem_key=?",
          input.mandateId,input.idempotencyKey);
        if(existing){
          if(existing.action_id!==input.actionId||existing.max_minor!==input.maximumMinor){
            throw new TreasuryError("conflict","Idempotency key reused with different terms");
          }
          return reservationView(existing);
        }
        const available=amt(m.economics.maxTotalMinor)-amt(g.spent_minor)-
          amt(g.reserved_minor)-amt(g.delegated_minor);
        if(amount>available)throw new TreasuryError("limit_exceeded","Mandate allowance unavailable");
        const a=getAccount();
        if(amount>amt(a.funded_minor)-amt(a.spent_minor)-amt(a.reserved_minor)){
          throw new TreasuryError("insufficient_funds","Account not funded for requested exposure");
        }
        const id="expense:"+crypto.randomUUID();
        sql.exec("INSERT INTO awc_expense VALUES (?,?,?,?,?,?,?)",
          id,input.mandateId,input.actionId,input.idempotencyKey,String(amount),null,"reserved");
        sql.exec("UPDATE awc_mandate SET reserved_minor=? WHERE id=?",
          String(amt(g.reserved_minor)+amount),g.id);
        sql.exec("UPDATE awc_account SET reserved_minor=? WHERE account_id=?",
          String(amt(a.reserved_minor)+amount),a.account_id);
        write("expense-reserved",id,amount);
        return reservationView(exactReservation(id));
      });
    },
    captureExpense(id:string,chargedMinor:string):DurableReservation{
      return storage.transactionSync(()=>{
        const expense=exactReservation(id),actual=amt(chargedMinor);
        if(expense.state==="captured"&&expense.captured_minor===String(actual))return reservationView(expense);
        if(expense.state!=="reserved"||actual>amt(expense.max_minor)){
          throw new TreasuryError("invalid_state","Charge exceeds reservation or was already settled");
        }
        const a=getAccount(),g=getMandate(expense.mandate_id),maximum=amt(expense.max_minor);
        sql.exec("UPDATE awc_expense SET state='captured',captured_minor=? WHERE id=?",String(actual),id);
        sql.exec("UPDATE awc_mandate SET reserved_minor=?,spent_minor=? WHERE id=?",
          String(amt(g.reserved_minor)-maximum),String(amt(g.spent_minor)+actual),g.id);
        sql.exec("UPDATE awc_account SET reserved_minor=?,spent_minor=? WHERE account_id=?",
          String(amt(a.reserved_minor)-maximum),String(amt(a.spent_minor)+actual),a.account_id);
        write("expense-captured",id,actual);
        return reservationView(exactReservation(id));
      });
    },
    releaseExpense(id:string):DurableReservation{
      return storage.transactionSync(()=>{
        const expense=exactReservation(id);
        if(expense.state==="released")return reservationView(expense);
        if(expense.state!=="reserved")throw new TreasuryError("invalid_state","Captured expenses cannot be released");
        const a=getAccount(),g=getMandate(expense.mandate_id),maximum=amt(expense.max_minor);
        sql.exec("UPDATE awc_expense SET state='released' WHERE id=?",id);
        sql.exec("UPDATE awc_mandate SET reserved_minor=? WHERE id=?",
          String(amt(g.reserved_minor)-maximum),g.id);
        sql.exec("UPDATE awc_account SET reserved_minor=? WHERE account_id=?",
          String(amt(a.reserved_minor)-maximum),a.account_id);
        write("expense-released",id,maximum);
        return reservationView(exactReservation(id));
      });
    },
    revokeMandate(id:string):void{
      storage.transactionSync(()=>{
        const g=getMandate(id);
        if(g.revoked===1)return;
        sql.exec("UPDATE awc_mandate SET revoked=1 WHERE id=?",id);
        write("mandate-revoked",id,0n);
      });
    },
    closeMandate(id:string):DurableMandate{
      return storage.transactionSync(()=>{
        const g=getMandate(id);
        if(g.closed===1)return mandateView(id);
        if(amt(g.reserved_minor)!==0n||amt(g.delegated_minor)!==0n){
          throw new TreasuryError("invalid_state","Outstanding liabilities or child allowances remain");
        }
        if(g.parent_id){
          const p=getMandate(g.parent_id),child=parseMandate(g);
          const amount=amt(child.economics.maxTotalMinor);
          if(amt(p.delegated_minor)<amount)throw new TreasuryError("invalid_state","Missing parent allocation");
          sql.exec("UPDATE awc_mandate SET delegated_minor=?,spent_minor=? WHERE id=?",
            String(amt(p.delegated_minor)-amount),
            String(amt(p.spent_minor)+amt(g.spent_minor)),p.id);
        }
        sql.exec("UPDATE awc_mandate SET closed=1,revoked=1 WHERE id=?",id);
        write("mandate-closed",id,0n);
        return mandateView(id);
      });
    },
    reservationByAction:(mandateId:string,actionId:string,idempotencyKey:string):
      DurableReservation|undefined=>{
      const row=selectOne<ReservationRow>(sql,
        "SELECT * FROM awc_expense WHERE mandate_id=? AND action_id=? AND idem_key=?",
        mandateId,actionId,idempotencyKey);
      return row?reservationView(row):undefined;
    },
    account:()=>accountView(),
    mandate:(id:string)=>mandateView(id),
    journal:()=>sql.exec<{sequence:number;kind:string;ref:string;amount_minor:string}>(
      "SELECT sequence,kind,ref,amount_minor FROM awc_journal ORDER BY sequence ASC"
    ).toArray()
  };
}
