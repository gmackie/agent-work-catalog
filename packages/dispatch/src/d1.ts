import { DispatchError, type DispatchStore, type DispatchRecord } from "./index.ts";
export interface D1Statement{
  bind(...args:(string|number|null)[]):D1Statement;
  run():Promise<{meta?:{changes?:number}}>;
  first<T>():Promise<T|null>;
  all<T>():Promise<{results:T[]}>;
}
export interface D1Database{prepare(sql:string):D1Statement;}
type Row={payload:string};
export function d1DispatchStore(db:D1Database):DispatchStore {
  return {
    initialize:async(record)=>{
      await db.prepare(
        "INSERT OR IGNORE INTO awc_dispatch (work_id,buyer_id,executor_id,request_digest,status,version,lease_until,next_check_at,payload) VALUES (?,?,?,?,?,?,?,?,?)"
      ).bind(record.workId,record.buyerId,record.executorId,record.requestDigest,record.status,
        record.version,record.leaseUntil,record.nextCheckAt,JSON.stringify(record)).run();
      const row=await db.prepare("SELECT payload FROM awc_dispatch WHERE work_id=? AND buyer_id=?")
        .bind(record.workId,record.buyerId).first<Row>();
      if(!row)throw new DispatchError("unavailable","Unable to load dispatch commitment");
      return JSON.parse(row.payload) as DispatchRecord;
    },
    get:async(buyerId,workId)=>{
      const row=await db.prepare("SELECT payload FROM awc_dispatch WHERE buyer_id=? AND work_id=?")
        .bind(buyerId,workId).first<Row>();
      return row?JSON.parse(row.payload) as DispatchRecord:undefined;
    },
    cas:async(before,after)=>{
      const result=await db.prepare(
        "UPDATE awc_dispatch SET status=?,version=?,lease_until=?,next_check_at=?,payload=? WHERE buyer_id=? AND work_id=? AND version=? AND status=? AND request_digest=?"
      ).bind(after.status,after.version,after.leaseUntil,after.nextCheckAt,JSON.stringify(after),
        before.buyerId,before.workId,before.version,before.status,before.requestDigest).run();
      return result.meta?.changes===1;
    },
    due:async(time,limit)=>{
      const rows=await db.prepare(
        "SELECT payload FROM awc_dispatch WHERE status NOT IN ('finalized','manual_review') AND lease_until <= ? AND next_check_at <= ? ORDER BY next_check_at LIMIT ?"
      ).bind(time,time,Math.max(1,Math.min(100,limit))).all<Row>();
      return rows.results.map(row=>{
        const record=JSON.parse(row.payload) as DispatchRecord;
        return {buyerId:record.buyerId,workId:record.workId};
      });
    },
  };
}
