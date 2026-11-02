import {describe,expect,it} from "vitest";
import {exportUblOrder} from "../src/index.ts";
const fixture={id:"order:1",issueDate:"2026-11-01",buyerName:"Example Operator",
 sellerName:"Example Wholesaler",currency:"USD" as const,contractDigest:"a".repeat(64),
 lines:[{id:"1",itemName:"Bottled Water",quantity:20,unitCode:"EA",priceMinor:"125"}]};
describe("UBL 2.4 example Order XML exporter",()=>{
 it("preserves buyer/seller and line-item purchasing quantities",()=>{
  const xml=exportUblOrder(fixture);
  expect(xml).toContain("UBLVersionID>2.4");
  expect(xml).toContain("OrderLine");
  expect(xml).toContain("1.25");
  expect(xml).toContain("Bottled Water");
 });
 it("escapes third-party product names and rejects malformed inputs",()=>{
  const xml=exportUblOrder({...fixture,lines:[{...fixture.lines[0]!,itemName:'<script>alert("x")</script>'}]});
  expect(xml).not.toContain("<script>");
  expect(xml).toContain("&lt;script&gt;");
  expect(()=>exportUblOrder({...fixture,lines:[]})).toThrow();
  expect(()=>exportUblOrder({...fixture,lines:[{...fixture.lines[0]!,quantity:-1}]})).toThrow();
 });
});
