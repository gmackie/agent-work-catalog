import { App } from "@modelcontextprotocol/ext-apps";
interface ContractResult {
  id?:string;
  state?:string;
  quoteDigest?:string;
  inputDigest?:string;
  reviewUrl?:string;
  quote?:{
    scope:string;
    offeringId:string;
    termsDigest:string;
    price:{currency:string;minorUnits:string};
    expiresAt:string;
  };
  commerce?:{status:string;paymentRail?:string};
}
const app=new App({name:"AWC Contract Inspector",version:"0.1.0"});
const status=document.querySelector<HTMLElement>("#status")!;
const details=document.querySelector<HTMLDListElement>("#terms")!;
const button=document.querySelector<HTMLButtonElement>("#review")!;
let url:string|undefined;
function addTerm(name:string,value:string){
  const dt=document.createElement("dt"),dd=document.createElement("dd");
  dt.textContent=name;dd.textContent=value;details.append(dt,dd);
}
function render(data:ContractResult) {
  details.replaceChildren();
  status.textContent=data.commerce?.status??data.state??"Prepared, unfunded";
  const price=data.quote?.price;
  const minor=price?.minorUnits;
  let formatted="Unavailable";
  if(price&&minor&&Number.isSafeInteger(Number(minor))) {
    formatted=(Number(minor)/100).toLocaleString("en-US",{style:"currency",currency:price.currency});
  }
  addTerm("Work order",data.id??"Unknown");
  addTerm("Offering",data.quote?.offeringId??"Unknown");
  addTerm("Scope",data.quote?.scope??"Not supplied");
  addTerm("Fixed quote",formatted);
  addTerm("Quote expiry",data.quote?.expiresAt??"Unknown");
  addTerm("Exact contract digest",data.quote?.termsDigest??data.quoteDigest??"Unknown");
  addTerm("Inputs commitment",data.inputDigest??"Unknown");
  addTerm("Execution","Not permitted until separately approved and funded");
  url=undefined;
  if(data.reviewUrl){
    try{
      const candidate=new URL(data.reviewUrl);
      if((candidate.protocol==="https:"||candidate.hostname==="localhost")&&candidate.pathname==="/review")url=candidate.toString();
    }catch{/* Invalid review link supplied. */}
  }
  button.disabled=!url;
}
app.ontoolresult=(value)=>{
  const d=value.structuredContent as ContractResult|undefined;
  if(d?.id&&d.quote)render(d);
};
button.onclick=async()=>{
  if(!url)return;
  status.textContent="Requesting host to open separately authenticated review...";
  try{
    const result=await app.openLink({url});
    status.textContent=result.isError?"Host declined to open the review page.":"Review page opened in your browser.";
  }catch{
    status.textContent="Host does not support external review links.";
  }
};
void app.connect().catch(()=>{status.textContent="Use a compatible MCP Apps host to inspect a work order.";});
