/**
 * GS1 EPCIS 2.0 JSON-LD restricted ObjectEvent projection.
 * The source is a *separately observed physical receipt*, NOT an order,
 * invoice, payment, inferred stock level or LLM statement. This module
 * does not verify source signatures, identifiers, or actual delivery.
 */
export const EPCIS_CONTEXT="https://ref.gs1.org/standards/epcis/2.0.0/epcis-context.jsonld";
export interface ObservedGoodsReceipt {
  readonly receiptId:string;
  readonly eventTime:string;
  readonly eventTimeZoneOffset:string;
  readonly readPointId:string;
  readonly businessLocationId:string;
  readonly productClassUri:string;
  readonly quantity:number;
  readonly unitOfMeasure:string;
  readonly verifiedSourceId:string;
}
export interface EpcisObjectEvent {
  readonly type:"ObjectEvent";
  readonly eventID:string;
  readonly eventTime:string;
  readonly eventTimeZoneOffset:string;
  readonly action:"OBSERVE";
  readonly bizStep:"receiving";
  readonly disposition:"in_progress";
  readonly readPoint:{readonly id:string};
  readonly bizLocation:{readonly id:string};
  readonly quantityList:readonly [{readonly epcClass:string;readonly quantity:number;readonly uom:string}];
}
export class EpcisError extends Error{
 constructor(readonly code:"invalid_receipt",message:string){super(message);this.name="EpcisError";}
}
const uri=(s:string)=> /^(https:\/\/|urn:epc:)/.test(s)&&!/[\s<>]/.test(s)&&s.length<500;
export function makeEpcisReceiptEvent(input:ObservedGoodsReceipt):EpcisObjectEvent {
 const time=Date.parse(input.eventTime);
 if(!/^[-+](?:0\d|1[0-3]):[0-5]\d$|^\+14:00$/.test(input.eventTimeZoneOffset) ||
   !Number.isFinite(time)||!/[+-]\d\d:\d\d$|Z$/.test(input.eventTime)||
   !/^[0-9a-fA-F-]{36}$/.test(input.receiptId) ||
   !uri(input.readPointId)||!uri(input.businessLocationId)||!uri(input.productClassUri)||
   !Number.isSafeInteger(input.quantity)||input.quantity<=0||
   !/^[A-Z0-9]{2,3}$/.test(input.unitOfMeasure)||
   !input.verifiedSourceId) {
   throw new EpcisError("invalid_receipt","Physical receiving evidence incomplete or invalid");
 }
 return {
  type:"ObjectEvent",eventID:"urn:uuid:"+input.receiptId,
  eventTime:input.eventTime,eventTimeZoneOffset:input.eventTimeZoneOffset,
  action:"OBSERVE",bizStep:"receiving",disposition:"in_progress",
  readPoint:{id:input.readPointId},bizLocation:{id:input.businessLocationId},
  quantityList:[{epcClass:input.productClassUri,quantity:input.quantity,uom:input.unitOfMeasure}],
 };
}
export function makeEpcisDocument(
 event:EpcisObjectEvent,creationDate:string,
) {
 if(!Number.isFinite(Date.parse(creationDate)))throw new EpcisError("invalid_receipt","Invalid EPCIS document timestamp");
 return {"@context":[EPCIS_CONTEXT],type:"EPCISDocument",schemaVersion:"2.0",
   creationDate,epcisBody:{eventList:[event]}};
}
