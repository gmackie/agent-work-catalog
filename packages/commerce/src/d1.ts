import { CommerceError, type WorkSnapshot, type WorkStateStore, type WorkRunMessage } from "./index.ts";
import type { PreparedWork } from "@awc/marketplace";

export interface D1Statement {
  bind(...values:(string|number|null)[]):D1Statement;
  run():Promise<{meta?:{changes?:number}}>;
  first<T>():Promise<T|null>;
  all<T>():Promise<{results:T[]}>;
}
export interface D1Database { prepare(sql:string):D1Statement; }
type Row={payload:string};

export function d1WorkStateStore(db:D1Database):WorkStateStore{
  return {
    initialize:async(work,now)=>{
      const snapshot:WorkSnapshot={
        id:work.id,buyerId:work.buyerId,quoteDigest:work.quoteDigest,
        status:"prepared_unfunded",version:0,attempts:0,updatedAt:now,
      };
      await db.prepare(
        "INSERT OR IGNORE INTO awc_commerce_state (id,buyer_id,status,version,lease_until,payload) VALUES (?,?,?,?,?,?)"
      ).bind(work.id,work.buyerId,snapshot.status,0,null,JSON.stringify(snapshot)).run();
      const row=await db.prepare("SELECT payload FROM awc_commerce_state WHERE id=? AND buyer_id=?")
        .bind(work.id,work.buyerId).first<Row>();
      if(!row) throw new CommerceError("unavailable","Failed to initialize commerce state");
      return JSON.parse(row.payload) as WorkSnapshot;
    },
    get:async(buyerId,id)=>{
      const row=await db.prepare("SELECT payload FROM awc_commerce_state WHERE id=? AND buyer_id=?")
        .bind(id,buyerId).first<Row>();
      return row?JSON.parse(row.payload) as WorkSnapshot:undefined;
    },
    cas:async(before,after)=>{
      const res=await db.prepare(
        "UPDATE awc_commerce_state SET status=?,version=?,lease_until=?,payload=? WHERE id=? AND buyer_id=? AND version=? AND status=?"
      ).bind(after.status,after.version,after.leaseUntil??null,JSON.stringify(after),
        before.id,before.buyerId,before.version,before.status).run();
      return res.meta?.changes===1;
    },
    recoverable:async(now,limit)=>{
      const res=await db.prepare(
        "SELECT payload FROM awc_commerce_state WHERE status='queued' OR (status='running' AND lease_until < ? AND json_extract(payload,'$.attempts') < 3) ORDER BY id LIMIT ?"
      ).bind(now,Math.min(100,Math.max(1,limit))).all<Row>();
      return res.results.map(row=>{
        const snapshot=JSON.parse(row.payload) as WorkSnapshot;
        return {workId:snapshot.id,buyerId:snapshot.buyerId} satisfies WorkRunMessage;
      });
    },
  };
}
