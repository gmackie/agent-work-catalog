import { Effect } from "effect";
import Stripe from "stripe";
import { createMcpHandler } from "agents/mcp/server";
import { makeMarketplace } from "@awc/marketplace";
import { d1MarketplaceStore, type D1Database as MarketplaceD1 } from "@awc/marketplace/d1";
import { createCatalogMcpServer, type PaidSandboxConfig } from "@awc/mcp-server";
import { d1WorkStateStore, type D1Database as CommerceD1 } from "@awc/commerce/d1";
import { makeCommerce, sandboxExecutor, type WorkRunMessage } from "@awc/commerce";
import { stripeTestCheckout } from "@awc/commerce/stripe";
import { identifyActor, requireScope, AuthError, type VerifiedActor } from "@awc/auth";
import { authzenMetadata, createAuthzenPdp, parseAuthzenEvaluation } from "@awc/authzen";
import { verifyPdpBearer, PdpAuthenticationError } from "@awc/pdp-auth";
import { createRegistryBackedPdp } from "@awc/mandate-registry";
import { d1TrustedMandateRegistry } from "@awc/mandate-registry/d1";
import { createTrustedMcpToolPdp } from "@awc/mandate-registry/tools";
import { d1McpToolPolicies } from "@awc/mandate-registry/d1-tools";
import { mapToolCall } from "@awc/coaz-mcp";
import { runStandardsScenario } from "@awc/standards-demo";

export interface Env {
  readonly DB: MarketplaceD1 & CommerceD1;
  readonly ASSETS: { fetch(request:Request|URL|string):Promise<Response> };
  readonly AWC_JOBS?: Queue<WorkRunMessage>;
  readonly AWC_BUYER_TOKEN?:string;
  readonly AWC_SANDBOX_HUMAN_TOKEN?:string;
  readonly ENABLE_LOCAL_SANDBOX?:string;
  readonly ENABLE_X402_TESTNET?:string;
  readonly X402_TESTNET_RECIPIENT?:string;
  readonly X402_FACILITATOR_URL?:string;
  readonly STRIPE_SECRET_KEY?:string;
  readonly STRIPE_WEBHOOK_SECRET?:string;
  readonly OIDC_ISSUER?:string;
  readonly OIDC_JWKS_URL?:string;
  readonly OIDC_MCP_AUDIENCE?:string;
  readonly OIDC_APPROVAL_AUDIENCE?:string;
  readonly OIDC_APPROVAL_CLIENT_ID?:string;
  readonly OIDC_APPROVAL_ACR?:string;
  readonly ALLOWED_ORIGINS?:string;
  /** Explicit opt-in to the AuthZEN PDP, separate from local synthetic demo mode. */
  readonly ENABLE_AUTHZEN_PDP?:string;
  readonly AUTHZEN_PUBLIC_ORIGIN?:string;
  readonly AUTHZEN_PDP_ISSUER?:string;
  readonly AUTHZEN_PDP_AUDIENCE?:string;
  readonly AUTHZEN_PDP_JWKS_URL?:string;
  readonly AUTHZEN_PDP_CLIENT_IDS?:string;
}
const json=(value:object,status=200)=>Response.json(value,{status,headers:{
  "cache-control":"no-store","x-content-type-options":"nosniff",
}});
const localSandbox=(request:Request,env:Env)=>env.ENABLE_LOCAL_SANDBOX==="true"&&
  ["localhost","127.0.0.1"].includes(new URL(request.url).hostname);
function authConfig(env:Env){
  return {
    issuer:env.OIDC_ISSUER,
    jwksUrl:env.OIDC_JWKS_URL,
    mcpAudience:env.OIDC_MCP_AUDIENCE,
    approvalAudience:env.OIDC_APPROVAL_AUDIENCE,
    approvalClientId:env.OIDC_APPROVAL_CLIENT_ID,
    allowedApprovalAcr:(env.OIDC_APPROVAL_ACR??"").split(",").map(x=>x.trim()).filter(Boolean),
    sandboxBuyerToken:env.AWC_BUYER_TOKEN,
    sandboxHumanToken:env.AWC_SANDBOX_HUMAN_TOKEN,
  };
}
const allowedOrigin=(request:Request,env:Env)=>{
  const origin=request.headers.get("origin");
  return !origin || origin===new URL(request.url).origin ||
    (env.ALLOWED_ORIGINS??"").split(",").map(x=>x.trim()).includes(origin);
};
function paidConfig(env:Env):PaidSandboxConfig|undefined{
  if(env.ENABLE_X402_TESTNET!=="true")return undefined;
  const address=env.X402_TESTNET_RECIPIENT;
  if(!/^0x[0-9a-fA-F]{40}$/.test(address??""))throw new Error("Invalid Base Sepolia sandbox recipient");
  const facilitator=env.X402_FACILITATOR_URL??"https://x402.org/facilitator";
  if(new URL(facilitator).protocol!=="https:")throw new Error("Facilitator must use HTTPS");
  return {network:"base-sepolia",recipient:address as `0x${string}`,facilitatorUrl:facilitator};
}
async function mismatch(request:Request):Promise<boolean>{
  if(request.method!=="POST"||request.headers.get("mcp-method")!=="tools/call")return false;
  const raw=await request.clone().text();
  if(raw.length>128_000)return true;
  try{
    const body=JSON.parse(raw) as {method?:unknown;params?:{name?:unknown}};
    return body?.method!=="tools/call"||typeof body.params?.name!=="string"||
      request.headers.get("mcp-name")!==body.params.name;
  }catch{return true;}
}
function services(env:Env,request:Request){
  const marketplace=makeMarketplace(d1MarketplaceStore(env.DB));
  const stripe=env.STRIPE_SECRET_KEY?.startsWith("sk_test_")
    ? new Stripe(env.STRIPE_SECRET_KEY)
    : undefined;
  const checkout=stripe ? stripeTestCheckout(stripe,new URL(request.url).origin):undefined;
  const commerce=makeCommerce(marketplace,d1WorkStateStore(env.DB),sandboxExecutor,{
    ...(checkout?{checkout}:{}),enableSandboxFunding:localSandbox(request,env),
  });
  return {marketplace,commerce,stripe};
}
async function principal(request:Request,env:Env,purpose:"mcp"|"human"){
  return identifyActor(request.headers.get("authorization"),purpose,authConfig(env),
    localSandbox(request,env));
}
const errorResponse=(e:unknown)=>{
  if(e instanceof AuthError)return json({error:e.code,message:e.message},e.code==="unauthorized"?401:503);
  if(e instanceof Error&&"code" in e){
    const code=String(e.code);
    if(["not_found"].includes(code))return json({error:code},404);
    if(["invalid_state","conflict"].includes(code))return json({error:code},409);
    if(["unauthorized"].includes(code))return json({error:code},403);
    if(["funding_required"].includes(code))return json({error:code},402);
  }
  return json({error:"unavailable"},503);
};
const reviewPage=`<!doctype html><html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Review Agent Work Contract</title><style>
:root{color-scheme:light dark;font:15px system-ui}body{max-width:720px;margin:28px auto;padding:20px;line-height:1.5}
label{display:block;margin:12px 0 5px}input{width:100%;box-sizing:border-box;padding:12px;border-radius:6px;border:1px solid #8092a8}
button{margin:14px 8px 10px 0;padding:12px;border:1px solid #4676b0;border-radius:8px;cursor:pointer}
pre{white-space:pre-wrap;overflow-wrap:anywhere;background:rgba(128,128,128,.12);padding:14px;border-radius:8px}
.warning{font-weight:bold;color:#b96a00}small{opacity:.7}</style></head><body>
<h1>Review work agreement</h1><p>This review happens outside the agent. The agent cannot use its own MCP token to approve.</p>
<p class="warning">Sandbox demo. Offers are fictional. No real professional service is delivered.</p>
<label for="token">Human approval credential (never paste your agent's MCP token)</label>
<input type="password" autocomplete="off" id="token" placeholder="Separate human approval token"/>
<button id="load">Inspect terms</button><div id="details" role="status"></div>
<button id="approve" disabled>Approve exact terms</button><button id="fund" disabled>Simulate funding (localhost only)</button>
<p id="status"></p><small>On a real deployment, this screen must use OIDC authorization code + PKCE and an independently authenticated human session. Do not reuse an agent's credentials.</small>
<script>
const id=new URLSearchParams(location.search).get("work"),token=document.querySelector("#token"),
  status=document.querySelector("#status"),details=document.querySelector("#details");
let reviewedDigest="";
function headers(){return {"authorization":"Bearer "+token.value,"content-type":"application/json"}}
async function read(){
 if(!id){status.textContent="Missing work ID";return}
 status.textContent="Loading private contract...";reviewedDigest="";
 document.querySelector("#approve").disabled=true;
 const r=await fetch("/api/review?work="+encodeURIComponent(id),{headers:headers(),cache:"no-store"});
 if(!r.ok){status.textContent="Authorization failed or work unavailable";return}
 const data=await r.json(),q=data.quote,w=data.work,s=data.state;
 reviewedDigest=q.termsDigest;
 details.replaceChildren();
 const pre=document.createElement("pre");pre.textContent=JSON.stringify({
  workId:w.id,offering:q.offeringId,scope:q.scope,
  amount:q.price,currency:q.price.currency,contractDigest:q.termsDigest,
  inputDigest:w.inputDigest,dataDisclosure:"This prototype does not transfer data to external workers",
  state:s.status,approvedBy:s.approvedBy??null,funding:s.paymentRail??null
 },null,2);details.append(pre);
 document.querySelector("#approve").disabled=s.status!=="prepared_unfunded";
 document.querySelector("#fund").disabled=s.status!=="approved"||location.hostname!=="localhost";
 status.textContent="Review the exact contract digest before approving.";
}
document.querySelector("#load").onclick=()=>read().catch(()=>status.textContent="Could not load contract");
document.querySelector("#approve").onclick=async()=>{
 if(!reviewedDigest||!confirm("Approve the exact displayed contract terms?"))return;
 const r=await fetch("/api/approve",{method:"POST",headers:headers(),
  body:JSON.stringify({workId:id,reviewedDigest})});
 status.textContent=r.ok?"Approval recorded; funds are NOT charged.":"Approval rejected";
 await read();
};
document.querySelector("#fund").onclick=async()=>{
 if(!confirm("SIMULATE funding with no real payment? Local sandbox only."))return;
 const r=await fetch("/api/dev/fund",{method:"POST",headers:headers(),body:JSON.stringify({workId:id})});
 status.textContent=r.ok?"Synthetic funding recorded; an authorized agent can now start the DEMO worker.":"Funding simulation rejected";
 await read();
};
</script></body></html>`;
/**
 * Public PDP deployment is opt-in and host-bound: there are no implicit
 * defaults to a test token, sandbox buyer, or caller-selected identity.
 */
function authzenPublicEnabled(url:URL,env:Env):boolean {
  if(env.ENABLE_AUTHZEN_PDP!=="true"||!env.AUTHZEN_PUBLIC_ORIGIN)return false;
  try{
    const origin=new URL(env.AUTHZEN_PUBLIC_ORIGIN);
    return origin.protocol==="https:" && origin.origin===origin.href.replace(/\/$/,"") &&
      url.protocol==="https:" && url.origin===origin.origin;
  }catch{return false;}
}
function pdpTokenConfig(env:Env){
  return {
    issuer:env.AUTHZEN_PDP_ISSUER??"",
    audience:env.AUTHZEN_PDP_AUDIENCE??"",
    jwksUrl:env.AUTHZEN_PDP_JWKS_URL??"",
    allowedClientIds:(env.AUTHZEN_PDP_CLIENT_IDS??"").split(",").map(x=>x.trim()).filter(Boolean),
    requiredScope:"awc:pdp:evaluate",
  };
}
const connectPage=`<!doctype html><html lang="en"><meta charset="UTF-8"/><title>AWC</title>
<body style="max-width:760px;margin:40px auto;font:16px system-ui;line-height:1.5">
<h1>Agent Work Catalog</h1><p>Experimental MCP server at <code>/mcp</code>.</p>
<p>Public catalog entries are fictional. Quotes and work contracts require an authenticated buyer.</p>
<p>Separate human review at <code>/review?work=WORK_ID</code>. All payments are either Stripe TEST or local synthetic funding. Worker output is synthetic.</p></body></html>`;

export async function handleRequest(request:Request,env:Env,ctx:ExecutionContext):Promise<Response>{
  const url=new URL(request.url);
  if(request.method==="GET"&&url.pathname==="/health")return json({
    status:"ok",service:"awc-mcp",money:"Stripe TEST or disabled",
    executor:"synthetic sandbox",livePayments:false,
  });

  // AuthZEN demo endpoints are available ONLY in a local sandbox. No production PDP
  // is exposed until an authenticated authoritative proposal/mandate registry exists.
  if(url.pathname==="/.well-known/authzen-configuration" ||
     url.pathname==="/access/v1/evaluation"){
    const isDemo=localSandbox(request,env);
    const isPublic=authzenPublicEnabled(url,env);
    if(!isDemo&&!isPublic)return json({error:"not_enabled"},404);
    if(!allowedOrigin(request,env))return json({error:"origin_not_allowed"},403);
    if(url.pathname==="/.well-known/authzen-configuration"){
      if(request.method!=="GET")return json({error:"method_not_allowed"},405);
      return isDemo
        ? json({...authzenMetadata(url.origin),awc_demo_only:true})
        : json(authzenMetadata(env.AUTHZEN_PUBLIC_ORIGIN!));
    }
    if(request.method!=="POST")return json({error:"method_not_allowed"},405);
    if(request.headers.get("content-type")?.split(";")[0]!=="application/json"){
      return json({error:"invalid_content_type"},415);
    }
    if(isPublic&&!isDemo){
      let caller;
      try{caller=await verifyPdpBearer(request.headers.get("authorization"),pdpTokenConfig(env));}
      catch(error){
        if(error instanceof PdpAuthenticationError){
          return json({error:error.code},error.code==="unauthorized"?401:503);
        }
        return json({error:"configuration_error"},503);
      }
      let parsed;
      try {
        const raw=await request.text();
        if(raw.length>16_384)return json({error:"request_too_large"},413);
        parsed=parseAuthzenEvaluation(JSON.parse(raw) as unknown);
      }catch{return json({error:"invalid_request"},400);}
      const trusted=d1TrustedMandateRegistry(env.DB);
      const decision=await createRegistryBackedPdp(trusted).evaluate(parsed,caller);
      return json(decision);
    }
    try{
      const actor=await principal(request,env,"mcp");
      if(!actor||actor.subject!=="sandbox-agent")return json({error:"unauthorized"},401);
      const text=await request.text();
      if(text.length>16_384)return json({error:"request_too_large"},413);
      const parsed=parseAuthzenEvaluation(JSON.parse(text) as unknown);
      const ref=parsed.context?.awc_proposal_id;
      const match=typeof ref==="string"
        ? /^proposal:demo:(vending|cloud|plant):(?:read|[0-9]+)$/.exec(ref)
        : null;
      if(!match)return json({decision:false,context:{awc_reason_codes:["NO_DEMO_REGISTRY_MATCH"]}});
      const scenario=match[1] as "vending"|"cloud"|"plant";
      const fixture=await runStandardsScenario(scenario);
      const proposals=[fixture.syntheticReadProposal,
        ...fixture.simulation.attemptedActions.map(a=>a.proposal)];
      const pdp=createAuthzenPdp({resolve:async(id)=>{
        const proposal=proposals.find(x=>x.id===id);
        return proposal?{proposal,policy:fixture.simulation.trustedPolicyContext}:undefined;
      }});
      // The only authenticated local buyer token represents the *synthetic*
      // fleet manager in this fixture. This alias is never used outside localhost.
      return json(await pdp.evaluate(parsed,{
        subjectId:fixture.simulation.mandate.delegateId,clientId:actor.subject,
      }));
    }catch{
      return json({error:"invalid_request"},400);
    }
  }
  if(request.method==="GET"&&(url.pathname==="/"||url.pathname==="/connect")){
    return new Response(connectPage,{headers:{"content-type":"text/html;charset=UTF-8","cache-control":"no-store"}});
  }
  if(request.method==="GET"&&url.pathname==="/review"){
    return new Response(reviewPage,{headers:{"content-type":"text/html;charset=UTF-8","cache-control":"no-store",
      "content-security-policy":"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'",
      "referrer-policy":"no-referrer"}});
  }
  if(!allowedOrigin(request,env))return json({error:"origin_not_allowed"},403);
  if(url.pathname==="/stripe/webhook"&&request.method==="POST"){
    if(!env.STRIPE_SECRET_KEY?.startsWith("sk_test_")||!env.STRIPE_WEBHOOK_SECRET){
      return json({error:"stripe_test_not_configured"},503);
    }
    try{
      const stripe=new Stripe(env.STRIPE_SECRET_KEY);
      const raw=await request.text();
      if(raw.length>500_000)return json({error:"too_large"},413);
      const event=stripe.webhooks.constructEvent(raw,request.headers.get("stripe-signature")??"",env.STRIPE_WEBHOOK_SECRET);
      if(event.livemode)return json({error:"live_mode_prohibited"},403);
      if(event.type==="checkout.session.completed"||event.type==="checkout.session.async_payment_succeeded"){
        const obj=event.data.object as Stripe.Checkout.Session;
        const workId=obj.metadata?.awc_work_id;
        const buyerId=obj.metadata?.awc_buyer_id;
        if(!workId||!buyerId)return json({error:"missing_contract_reference"},422);
        const {commerce}=services(env,request);
        await Effect.runPromise(commerce.reconcileStripe(buyerId,workId));
      }
      return json({received:true});
    }catch(e){return errorResponse(e);}
  }
  if(url.pathname==="/api/review"&&request.method==="GET"){
    try{
      const actor=requireScope(await principal(request,env,"human"),"work:approve");
      const workId=url.searchParams.get("work")??"";
      const {commerce}=services(env,request);
      return json(await Effect.runPromise(commerce.preview(actor.buyerId,workId)));
    }catch(e){return errorResponse(e);}
  }
  if(["/api/approve","/api/dev/fund"].includes(url.pathname)&&request.method==="POST"){
    try{
      const actor=requireScope(await principal(request,env,"human"),"work:approve");
      if(request.headers.get("content-type")?.split(";")[0]!=="application/json")return json({error:"invalid_content_type"},415);
      const raw=await request.text();
      if(raw.length>4000)return json({error:"payload_too_large"},413);
      const payload=JSON.parse(raw) as {workId?:unknown;reviewedDigest?:unknown};
      if(typeof payload.workId!=="string"||!/^work_[a-z0-9-]{36}$/.test(payload.workId))return json({error:"invalid_work_id"},400);
      const {commerce}=services(env,request);
      if(url.pathname==="/api/dev/fund"){
        if(!localSandbox(request,env)||actor.ceremony!=="local-sandbox-only"||
          !actor.scopes.includes("billing:dev-fund"))return json({error:"sandbox_only"},403);
        return json(await Effect.runPromise(commerce.sandboxFund(actor.buyerId,payload.workId)));
      }
      if(typeof payload.reviewedDigest!=="string"||!/^[a-f0-9]{64}$/.test(payload.reviewedDigest)){
        return json({error:"invalid_contract_digest"},400);
      }
      return json(await Effect.runPromise(commerce.approve(actor.buyerId,payload.workId,{
        buyerId:actor.buyerId,approverSubject:actor.subject,reviewedDigest:payload.reviewedDigest,
        ceremony:actor.ceremony!,
      })));
    }catch(e){return errorResponse(e);}
  }
  if(url.pathname!=="/mcp")return json({error:"not_found"},404);
  if(await mismatch(request))return json({error:"routing_header_mismatch"},400);
  try{
    const actor=await principal(request,env,"mcp");
    const {marketplace,commerce,stripe}=services(env,request);
    const local=localSandbox(request,env);
    const authzenReady=authzenPublicEnabled(url,env);
    const verifiedToolActor=actor?.kind==="agent"&&actor.clientId&&actor.tenantId
      ? {tenantId:actor.tenantId,subjectId:actor.subject,
          clientId:actor.clientId,scopes:actor.scopes,
          audience:url.origin+"/mcp"}
      : null;
    const toolPdp=authzenReady&&verifiedToolActor
      ? createTrustedMcpToolPdp(d1McpToolPolicies(env.DB))
      : null;
    const ui=await env.ASSETS.fetch("https://assets.local/marketplace.html");
    const contractUi=await env.ASSETS.fetch("https://assets.local/contract.html");
    const operationsUi=await env.ASSETS.fetch("https://assets.local/operations.html");
    const paid=paidConfig(env);
    // Load static App bundles once and provide the strings to the stateless MCP factory.
    const [html,contract,operations]=await Promise.all([
      ui.ok?ui.text():Promise.resolve(""),
      contractUi.ok?contractUi.text():Promise.resolve(""),
      operationsUi.ok?operationsUi.text():Promise.resolve(""),
    ]);
    const configured=createMcpHandler(()=>createCatalogMcpServer({
      marketplace,commerce,
      buyerId:actor?.kind==="agent"&&(local||toolPdp)?actor.buyerId:null,
      buyerScopes:actor?.scopes??[],approvalBaseUrl:url.origin,
      authorizationMode:local?"legacy-sandbox":"authzen-required",
      ...(toolPdp&&verifiedToolActor?{authorizePrivateTool:async(name:string,args:Readonly<Record<string,unknown>>)=>{
        const invocation={method:"tools/call" as const,params:{name,arguments:args}};
        const request=mapToolCall(invocation,verifiedToolActor);
        const decision=await toolPdp.evaluate(request,verifiedToolActor);
        return decision.decision===true;
      }}:{}),
      appHtml:html,contractAppHtml:contract,operationsAppHtml:operations,
      ...(env.AWC_JOBS ? {enqueue:async (msg:WorkRunMessage)=>{await env.AWC_JOBS!.send(msg);}} : {}),
      stripeCheckoutAvailable:!!stripe,
      ...(paid?{paidSandbox:paid}:{}),
    }),{route:"/mcp",corsOptions:false});
    return configured(request,env,ctx);
  }catch(e){return errorResponse(e);}
}

export async function consumeWorkQueue(batch:MessageBatch<unknown>,env:Env):Promise<void>{
  const request=new Request("https://awc.internal/health");
  const {commerce}=services(env,request);
  for(const msg of batch.messages){
    try{
      const candidate:unknown=msg.body;
      if(!candidate || typeof candidate!=="object" || Array.isArray(candidate)){msg.ack();continue;}
      const payload=candidate as {workId?:unknown;buyerId?:unknown};
      if(typeof payload.workId!=="string"||typeof payload.buyerId!=="string"||
         payload.workId.length>160||payload.buyerId.length>200){msg.ack();continue;}
      await Effect.runPromise(commerce.runQueued({workId:payload.workId,buyerId:payload.buyerId}));
      msg.ack();
    }catch(e){
      const reason=e instanceof Error?e.message:"";
      if(/not queued|already|another execution|needs explicit human|Work not queued/.test(reason))msg.ack();
      else msg.retry({delaySeconds:20});
    }
  }
}
export async function recoverQueued(env:Env):Promise<void>{
  if(!env.AWC_JOBS)return;
  const {commerce}=services(env,new Request("https://awc.internal/health"));
  for(const message of await Effect.runPromise(commerce.recoverable())){
    await env.AWC_JOBS.send(message);
  }
}
/** Private SQLite-backed Durable Object class; no public treasury write APIs exist yet. */
export { AWCEconomicAccount } from "./treasury.ts";
export default {
  fetch:handleRequest,
  queue:consumeWorkQueue,
  scheduled:async(_event:ScheduledController,env:Env,_ctx:ExecutionContext)=>recoverQueued(env),
} satisfies ExportedHandler<Env>;
