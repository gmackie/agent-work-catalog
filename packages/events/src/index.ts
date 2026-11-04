import type { ActionProposal } from "@awc/responsibility";
import type { ActionReceipt } from "@awc/operations";

/** CNCF CloudEvents JSON Event Format v1.0.2 (specversion remains "1.0"). */
export interface AWCCloudEvent<T=unknown> {
  readonly specversion:"1.0";
  readonly id:string;
  readonly source:string;
  readonly type:string;
  readonly subject:string;
  readonly time:string;
  readonly datacontenttype:"application/json";
  /** AWC extension: monotonic per-source/subject sequence supplied by trusted event store. */
  readonly awcsequence:number;
  readonly data:T;
}
export class CloudEventError extends Error {
  readonly _tag="CloudEventError";
  constructor(readonly code:"invalid_event"|"replay_conflict"|"out_of_order",message:string){
    super(message);this.name="CloudEventError";
  }
}
const validTime=(s:string)=>Number.isFinite(Date.parse(s)) && /Z$|[+-]\d\d:\d\d$/.test(s);
export function makeCloudEvent<T>(item:{
  id:string;source:string;type:string;subject:string;time:string;sequence:number;data:T;
}):AWCCloudEvent<T> {
  if(!item.id||item.id.length>300||!item.source||!item.type||!item.subject||
    !Number.isSafeInteger(item.sequence)||item.sequence<=0||!validTime(item.time) ||
    !/^(urn:|https?:\/|\/)/.test(item.source)) {
    throw new CloudEventError("invalid_event","Invalid CloudEvents context or sequence");
  }
  return {
    specversion:"1.0",id:item.id,source:item.source,type:item.type,subject:item.subject,
    time:item.time,datacontenttype:"application/json",awcsequence:item.sequence,data:item.data,
  };
}
export function actionReceiptEvent(proposal:ActionProposal,receipt:ActionReceipt,sequence:number) {
  if(receipt.proposalId!==proposal.id||receipt.revision!==proposal.revision||
    receipt.entityId!==proposal.entityId||receipt.operationId!==proposal.operationId) {
    throw new CloudEventError("invalid_event","Receipt does not bind to action proposal");
  }
  return makeCloudEvent({
    id:receipt.eventId,source:"urn:awc:operation:"+encodeURIComponent(receipt.operationId),
    type:"dev.awc.action.committed.v1",subject:receipt.entityId,
    time:receipt.acceptedAt,sequence,
    data:{
      proposalId:proposal.id,revision:proposal.revision,
      afterStateVersion:receipt.afterVersion,
      simulated:true,
      ...(receipt.reservationId?{reservationRef:receipt.reservationId}:{}),
    },
  });
}
export function mandateRevokedEvent(input:{
  id:string;mandateId:string;operationId:string;at:string;sequence:number;
}) {
  return makeCloudEvent({id:input.id,source:"urn:awc:operation:"+encodeURIComponent(input.operationId),
    type:"dev.awc.mandate.revoked.v1",subject:input.mandateId,time:input.at,sequence:input.sequence,
    data:{mandateId:input.mandateId}});
}
const serial=(x:unknown):string => JSON.stringify(x);
/** In-memory sample; a production CloudEvents inbox needs transactional deduplication. */
export function makeMemoryEventJournal(){
  const events=new Map<string,AWCCloudEvent>();
  const positions=new Map<string,number>();
  return {
    append<T>(event:AWCCloudEvent<T>):{accepted:boolean;event:AWCCloudEvent<T>} {
      if(event.specversion!=="1.0"||!event.subject||!event.id||
        !Number.isSafeInteger(event.awcsequence)||event.awcsequence<1){
        throw new CloudEventError("invalid_event","Malformed CloudEvent");
      }
      const key=event.source+"|"+event.id;
      const prior=events.get(key);
      if(prior){
        if(serial(prior)!==serial(event))throw new CloudEventError("replay_conflict","Duplicate event ID changed terms");
        return {accepted:false,event};
      }
      const subjectKey=event.source+"|"+event.subject;
      const previous=positions.get(subjectKey)??0;
      if(event.awcsequence!==previous+1){
        throw new CloudEventError("out_of_order","Missing or out-of-order sequence");
      }
      events.set(key,event);
      positions.set(subjectKey,event.awcsequence);
      return {accepted:true,event};
    },
    list(source:string,subject:string):readonly AWCCloudEvent[] {
      return [...events.values()].filter(x=>x.source===source&&x.subject===subject)
        .sort((a,b)=>a.awcsequence-b.awcsequence);
    },
  };
}
