/**
 * OASIS UBL 2.4 Order XML example subset. This is a safe exporter, NOT an
 * XSD/code-list compliant e-invoicing implementation nor an accepted purchase.
 * A real integration must use OASIS schema and jurisdictional validation.
 */
export class UblError extends Error {
  constructor(readonly code:"invalid_order"|"invalid_money",message:string){
    super(message);this.name="UblError";
  }
}
export interface OrderLine {
 readonly id:string;readonly itemName:string;readonly quantity:number;
 readonly unitCode:string;readonly priceMinor:string;
}
export interface AWCOrder {
 readonly id:string;readonly issueDate:string;readonly buyerName:string;readonly sellerName:string;
 readonly currency:"USD"|"EUR";readonly lines:readonly OrderLine[];
 readonly contractDigest:string;
}
const esc=(s:string)=>s.replace(/&/g,"&amp;").replace(/</g,"&lt;")
  .replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&apos;");
const cash=(minor:string)=>{
 if(!/^(0|[1-9][0-9]*)$/.test(minor)||BigInt(minor)>100000000000000n){
  throw new UblError("invalid_money","Unsupported price");
 }
 const value=BigInt(minor);return (value/100n)+"."+(value%100n).toString().padStart(2,"0");
};
export function exportUblOrder(order:AWCOrder):string {
 if(!order.id||!order.buyerName||!order.sellerName||
   !/^\d{4}-\d{2}-\d{2}$/.test(order.issueDate)||
   !/^[a-f0-9]{64}$/.test(order.contractDigest)||
   order.lines.length===0||order.lines.length>100||
   !order.lines.every(x=>x.id&&x.itemName&&
    /^[A-Z]{2,3}$/.test(x.unitCode)&&Number.isSafeInteger(x.quantity)&&x.quantity>0)){
  throw new UblError("invalid_order","Invalid basic order or missing contract reference");
 }
 const lines=order.lines.map(item=>`
 <cac:OrderLine>
  <cac:LineItem>
   <cbc:ID>${esc(item.id)}</cbc:ID>
   <cbc:Quantity unitCode="${esc(item.unitCode)}">${item.quantity}</cbc:Quantity>
   <cac:Price><cbc:PriceAmount currencyID="${order.currency}">${cash(item.priceMinor)}</cbc:PriceAmount></cac:Price>
   <cac:Item><cbc:Name>${esc(item.itemName)}</cbc:Name></cac:Item>
  </cac:LineItem>
 </cac:OrderLine>`).join("");
 return `<?xml version="1.0" encoding="UTF-8"?>
<Order xmlns="urn:oasis:names:specification:ubl:schema:xsd:Order-2"
 xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"
 xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2">
 <cbc:UBLVersionID>2.4</cbc:UBLVersionID>
 <cbc:ID>${esc(order.id)}</cbc:ID>
 <cbc:IssueDate>${order.issueDate}</cbc:IssueDate>
 <cbc:Note>AWC contract commitment sha256:${order.contractDigest}</cbc:Note>
 <cbc:DocumentCurrencyCode>${order.currency}</cbc:DocumentCurrencyCode>
 <cac:BuyerCustomerParty><cac:Party><cac:PartyName><cbc:Name>${esc(order.buyerName)}</cbc:Name></cac:PartyName></cac:Party></cac:BuyerCustomerParty>
 <cac:SellerSupplierParty><cac:Party><cac:PartyName><cbc:Name>${esc(order.sellerName)}</cbc:Name></cac:PartyName></cac:Party></cac:SellerSupplierParty>
 ${lines}
</Order>`;
}
