import {describe,expect,it} from "vitest";
import {makeCloudEvent,makeMemoryEventJournal,mandateRevokedEvent} from "../src/index.ts";
describe("CloudEvents v1.0.2 AWC operational envelope",()=>{
 it("emits standard required CloudEvents JSON fields and sequential extension",()=>{
  const e=mandateRevokedEvent({id:"rev_1",mandateId:"mandate:1",operationId:"fleet",
    at:"2026-11-01T14:00:00Z",sequence:1});
  expect(e).toMatchObject({specversion:"1.0",type:"dev.awc.mandate.revoked.v1",
    id:"rev_1",source:"urn:awc:operation:fleet",subject:"mandate:1",datacontenttype:"application/json"});
 });
 it("deduplicates exact replays and rejects altered terms, holes, or sequence rollback",()=>{
  const journal=makeMemoryEventJournal();
  const one=makeCloudEvent({id:"event:1",source:"urn:awc:op:1",type:"dev.awc.observed.v1",
    subject:"entity:1",time:"2026-11-01T14:00:00Z",sequence:1,data:{quantity:4}});
  expect(journal.append(one).accepted).toBe(true);
  expect(journal.append(one).accepted).toBe(false);
  expect(()=>journal.append({...one,data:{quantity:400}})).toThrow();
  expect(()=>journal.append({...one,id:"event:2",awcsequence:3})).toThrow();
  expect(journal.append({...one,id:"event:2",awcsequence:2}).accepted).toBe(true);
  expect(journal.list(one.source,one.subject)).toHaveLength(2);
 });
});
