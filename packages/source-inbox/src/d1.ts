import { AdapterError, type WorkOpportunity } from "@awc/adapter-sdk";
import { type SourceInbox, type StoredOpportunity, validateInbound } from "./index.ts";
export interface D1Statement {
  bind(...values:(string|number|null)[]):D1Statement;
  first<T>():Promise<T|null>;
  all<T>():Promise<{results:T[]}>;
}
export interface D1Database {
  prepare(sql:string):D1Statement;
  batch(statements:D1Statement[]):Promise<unknown[]>;
}
type EventRow={digest:string};
type Row={buyer_id:string;source_id:string;payload:string;first_seen_at:string};
/** D1 transactional event inbox; opportunities do not auto-authorize or execute. */
export function d1SourceInbox(db:D1Database,now:()=>string=()=>new Date().toISOString()):SourceInbox {
  const mapRow=(row:Row):StoredOpportunity=>({
    buyerId:row.buyer_id,sourceId:row.source_id,firstSeenAt:row.first_seen_at,
    opportunity:JSON.parse(row.payload) as WorkOpportunity,
  });
  return {
    record:async(buyerId,opportunity,digest)=>{
      validateInbound(buyerId,opportunity,digest);
      const source=opportunity.external.sourceId;
      const key=[source,opportunity.eventId] as const;
      const existing=await db.prepare(
        "SELECT digest FROM awc_inbound_events WHERE source_id=? AND event_id=?"
      ).bind(...key).first<EventRow>();
      if(existing?.digest!==undefined && existing.digest!==digest)
        throw new AdapterError("conflict","Delivery ID reused with different payload");
      if(existing) return {eventId:opportunity.eventId,opportunityId:opportunity.id,duplicate:true};
      await db.batch([
        db.prepare("INSERT OR IGNORE INTO awc_inbound_events (source_id,event_id,digest,received_at) VALUES (?,?,?,?)")
          .bind(source,opportunity.eventId,digest,now()),
        db.prepare("INSERT OR IGNORE INTO awc_opportunities (id,buyer_id,source_id,payload,first_seen_at) VALUES (?,?,?,?,?)")
          .bind(opportunity.id,buyerId,source,JSON.stringify(opportunity),now()),
      ]);
      const actual=await db.prepare("SELECT digest FROM awc_inbound_events WHERE source_id=? AND event_id=?")
        .bind(...key).first<EventRow>();
      if(actual?.digest!==digest)throw new AdapterError("conflict","Event digest changed during commit");
      return {eventId:opportunity.eventId,opportunityId:opportunity.id,duplicate:false};
    },
    list:async(buyerId,limit)=>{
      if(!buyerId||!Number.isInteger(limit)||limit<1||limit>50)
        throw new AdapterError("invalid_input","Invalid page size or buyer");
      const data=await db.prepare(
        "SELECT buyer_id,source_id,payload,first_seen_at FROM awc_opportunities WHERE buyer_id=? ORDER BY first_seen_at DESC,id LIMIT ?"
      ).bind(buyerId,limit).all<Row>();
      return data.results.map(mapRow);
    },
    get:async(buyerId,id)=>{
      const row=await db.prepare(
        "SELECT buyer_id,source_id,payload,first_seen_at FROM awc_opportunities WHERE buyer_id=? AND id=?"
      ).bind(buyerId,id).first<Row>();
      return row?mapRow(row):undefined;
    },
  };
}
