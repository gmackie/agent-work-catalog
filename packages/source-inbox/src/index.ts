import type { WorkOpportunity } from "@awc/adapter-sdk";
import { AdapterError } from "@awc/adapter-sdk";

export interface StoredOpportunity {
  readonly opportunity: WorkOpportunity;
  readonly buyerId: string;
  readonly sourceId: string;
  readonly firstSeenAt: string;
}
export interface IngestReceipt {
  readonly eventId: string;
  readonly opportunityId: string;
  readonly duplicate: boolean;
}
export interface SourceInbox {
  readonly record: (buyerId: string, opportunity: WorkOpportunity, rawBodyDigest: string) => Promise<IngestReceipt>;
  readonly list: (buyerId: string, limit: number) => Promise<readonly StoredOpportunity[]>;
  readonly get: (buyerId: string, id: string) => Promise<StoredOpportunity | undefined>;
}
export function validateInbound(buyerId:string,opportunity:WorkOpportunity,digest:string):void {
  if(!buyerId||buyerId.length>200||!opportunity.id||opportunity.id.length>200||
    !opportunity.external.sourceId||opportunity.external.sourceId.length>120||
    !opportunity.eventId||opportunity.eventId.length>100||
    !/^[a-f0-9]{64}$/.test(digest)||
    opportunity.schemaVersion!=="awc.opportunity/v1"||
    opportunity.description.length>30_000){
    throw new AdapterError("invalid_input","Source inbox entry out of bounds");
  }
}
/** One-process test store. Production requires a transactional inbox and retained delivery IDs. */
export function inMemorySourceInbox(now:()=>string=()=>new Date().toISOString()):SourceInbox {
  const events=new Map<string,string>(), rows=new Map<string,StoredOpportunity>();
  return {
    record: async (buyerId,opportunity,digest)=>{
      validateInbound(buyerId,opportunity,digest);
      const eventKey=opportunity.external.sourceId+":"+opportunity.eventId;
      const previous=events.get(eventKey);
      if(previous && previous!==digest)throw new AdapterError("conflict","Delivery ID reused with different payload");
      if(!previous){
        events.set(eventKey,digest);
        const key=buyerId+":"+opportunity.id;
        if(!rows.has(key))rows.set(key,{buyerId,sourceId:opportunity.external.sourceId,
          opportunity,firstSeenAt:now()});
      }
      return {eventId:opportunity.eventId,opportunityId:opportunity.id,duplicate:!!previous};
    },
    list:async(buyerId,limit)=>[...rows.values()].filter(x=>x.buyerId===buyerId)
      .sort((a,b)=>b.firstSeenAt.localeCompare(a.firstSeenAt)).slice(0,limit),
    get:async(buyerId,id)=>rows.get(buyerId+":"+id),
  };
}
