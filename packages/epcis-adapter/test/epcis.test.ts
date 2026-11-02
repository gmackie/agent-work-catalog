import {describe,expect,it} from "vitest";
import {makeEpcisDocument,makeEpcisReceiptEvent} from "../src/index.ts";
const physical={
 receiptId:"4898a223-216a-4f46-9e18-338ccf6fa3ba",
 eventTime:"2026-11-01T13:00:00Z",
 eventTimeZoneOffset:"+00:00",
 readPointId:"urn:epc:id:sgln:0614141.00777.0",
 businessLocationId:"urn:epc:id:sgln:0614141.00888.0",
 productClassUri:"urn:epc:class:lgtin:4012345.012345.998877",
 quantity:12,unitOfMeasure:"EA",
 verifiedSourceId:"scanner:simulated-123",
};
describe("GS1 EPCIS receiving event projection",()=>{
 it("outputs bounded JSON-LD ObjectEvent with physical observation source requirement",()=>{
  const event=makeEpcisReceiptEvent(physical);
  expect(event.bizStep).toBe("receiving");
  expect(event.action).toBe("OBSERVE");
  expect(event.quantityList[0]?.quantity).toBe(12);
  const doc=makeEpcisDocument(event,"2026-11-01T13:01:00Z");
  expect(doc.schemaVersion).toBe("2.0");
  expect(doc.epcisBody.eventList).toHaveLength(1);
 });
 it("will not turn an invoice or an unfounded stock estimate into physical receipt",()=>{
  expect(()=>makeEpcisReceiptEvent({...physical,verifiedSourceId:""})).toThrow();
  expect(()=>makeEpcisReceiptEvent({...physical,quantity:0})).toThrow();
  expect(()=>makeEpcisReceiptEvent({...physical,readPointId:"http://internal.local"})).toThrow();
  expect(()=>makeEpcisReceiptEvent({...physical,eventTimeZoneOffset:"invalid"})).toThrow();
 });
});
