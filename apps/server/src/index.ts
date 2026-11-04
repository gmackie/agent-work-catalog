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
import { createGitHubIssueSource, type AllowedRepo } from "@awc/adapter-github";
import { AdapterError } from "@awc/adapter-sdk";
import { d1SourceInbox, type D1Database as SourceD1 } from "@awc/source-inbox/d1";
import { createRemoteHttpExecutor } from "@awc/adapter-remote-http";
import { makeTrustedDispatcher,externalDisclosureDigest,
  type TrustedExecutorBinding,type TrustedDispatcher } from "@awc/dispatch";
import { d1DispatchStore,type D1Database as DispatchD1 } from "@awc/dispatch/d1";
import { createR2ArtifactCustody,type R2BucketLike,type ArtifactCustody } from "@awc/artifact-custody";
import { createModbusResultProcessor } from "@awc/modbus-workflow";
import { analyzeClassicPcap, MAX_CAPTURE_BYTES,PCAP_MEDIA_TYPE } from "@awc/modbus-pcap";
import { verifyObservation } from "@awc/attest-receipts";

export interface Env {
  readonly DB: MarketplaceD1 & CommerceD1 & SourceD1 & DispatchD1;
  readonly ASSETS: { fetch(request:Request|URL|string):Promise<Response> };
  readonly ARTIFACTS?:R2Bucket;
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
  readonly ENABLE_GITHUB_SOURCE?:string;
  readonly GITHUB_WEBHOOK_SECRET?:string;
  /** JSON array of explicit {repositoryId,fullName,installationId}, approved by admin. */
  readonly GITHUB_SOURCE_REPOSITORIES?:string;
  /** Trusted local tenant/buyer mapping, NEVER taken from the webhook payload. */
  readonly GITHUB_SOURCE_BUYER_ID?:string;
  readonly ENABLE_TRUSTED_REMOTE_DISPATCH?:string;
  readonly AWC_REMOTE_EXECUTOR_ID?:string;
  readonly AWC_REMOTE_EXECUTOR_ORIGIN?:string;
  readonly AWC_REMOTE_EXECUTOR_HOST?:string;
  readonly AWC_REMOTE_EXECUTOR_SHARED_KEY?:string;
  readonly ENABLE_MODBUS_PCAP?:string;
  readonly AWC_ATTEST_OBSERVATION_ISSUER?:string;
  readonly AWC_ATTEST_KEY_ID?:string;
  readonly AWC_ATTEST_PRIVATE_KEY_PEM?:string;
  readonly AWC_ATTEST_PUBLIC_KEY_PEM?:string;
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
function artifactCustody(env:Env):ArtifactCustody|undefined{
  if(!env.ARTIFACTS)return undefined;
  const binding=env.ARTIFACTS;
  const bucket:R2BucketLike={
    get:async(key)=>{
      const item=await binding.get(key);
      return item&&"arrayBuffer" in item
        ? {size:item.size,arrayBuffer:()=>item.arrayBuffer()}:null;
    },
    put:async(key,content,options)=>binding.put(key,Uint8Array.from(content).buffer,{
      sha256:options.sha256,httpMetadata:options.httpMetadata,
    }),
  };
  return createR2ArtifactCustody(bucket);
}
function services(env:Env,request:Request){
  const marketplace=makeMarketplace(d1MarketplaceStore(env.DB));
  const stripe=env.STRIPE_SECRET_KEY?.startsWith("sk_test_")
    ? new Stripe(env.STRIPE_SECRET_KEY)
    : undefined;
  const checkout=stripe ? stripeTestCheckout(stripe,new URL(request.url).origin):undefined;
  // All routing is installation-configured. An advertised provider URL or MCP response
  // can never choose the executor or override the price, data policy or task type.
  let binding:TrustedExecutorBinding|undefined;
  let remote:ReturnType<typeof createRemoteHttpExecutor>|undefined;
  const boundedPcap=env.ENABLE_MODBUS_PCAP==="true";
  const custody=artifactCustody(env);
  if(boundedPcap && (!custody || !env.AWC_ATTEST_PRIVATE_KEY_PEM ||
      !env.AWC_ATTEST_PUBLIC_KEY_PEM || !env.AWC_ATTEST_OBSERVATION_ISSUER ||
      !env.AWC_ATTEST_KEY_ID || env.ENABLE_TRUSTED_REMOTE_DISPATCH!=="true")) {
    throw new AdapterError("unavailable","Bounded PCAP mode requires private R2 custody and pinned receipt issuer keys");
  }
  if(env.ENABLE_TRUSTED_REMOTE_DISPATCH==="true"){
    if(!env.AWC_REMOTE_EXECUTOR_ID || !env.AWC_REMOTE_EXECUTOR_ORIGIN ||
       !env.AWC_REMOTE_EXECUTOR_HOST || !env.AWC_REMOTE_EXECUTOR_SHARED_KEY){
      throw new AdapterError("unavailable","Remote executor requires reviewed origin, identity and a secret");
    }
    remote=createRemoteHttpExecutor({
      id:env.AWC_REMOTE_EXECUTOR_ID,baseUrl:env.AWC_REMOTE_EXECUTOR_ORIGIN,
      allowedHost:env.AWC_REMOTE_EXECUTOR_HOST,
      sharedKey:env.AWC_REMOTE_EXECUTOR_SHARED_KEY,
      supportedTaskTypes:[boundedPcap?"task:modbus-pcap":"task:modbus-diagnostics"],
    });
    binding={
      id:env.AWC_REMOTE_EXECUTOR_ID,origin:new URL(env.AWC_REMOTE_EXECUTOR_ORIGIN).origin+"/",
      offeringId:boundedPcap?"offering:modbus-pcap-analysis":"offering:modbus-report",
      offeringVersion:"1",
      taskTypeId:boundedPcap?"task:modbus-pcap":"task:modbus-diagnostics",
      maxCostMinorUnits:"3500",outputMediaTypes:["application/json"],
      maxDurationSeconds:120,dataClassification:"public",allowedEffects:[],
      executionMode:boundedPcap?"bounded-modbus-pcap/v1":"synthetic-test-only",
    };
  }
  const commerce=makeCommerce(marketplace,d1WorkStateStore(env.DB),sandboxExecutor,{
    ...(checkout?{checkout}:{}),
    enableSandboxFunding:localSandbox(request,env),
    ...(binding?{externalDisclosureDigest:async(work,quote)=>
      work.offeringId===binding!.offeringId
        ? externalDisclosureDigest(work,quote,binding!) : undefined}:{}),
  });
  const resultProcessor=boundedPcap&&custody ? createModbusResultProcessor(custody,{
    issuerId:env.AWC_ATTEST_OBSERVATION_ISSUER!,
    keyId:env.AWC_ATTEST_KEY_ID!,
    privateKeyPem:env.AWC_ATTEST_PRIVATE_KEY_PEM!,
    publicKeyPem:env.AWC_ATTEST_PUBLIC_KEY_PEM!,
  }):undefined;
  const remoteDispatcher=remote && binding
    ? makeTrustedDispatcher(commerce,d1DispatchStore(env.DB),remote,binding,Date.now,{
      ...(boundedPcap&&custody?{inputResolver:custody}:{}),
      ...(resultProcessor?{resultProcessor}:{}),
    })
    : undefined;
  return {marketplace,commerce,stripe,remoteDispatcher,custody};
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
    if(["unauthenticated"].includes(code))return json({error:code},401);
    if(["unauthorized"].includes(code))return json({error:code},403);
    if(["invalid_input"].includes(code))return json({error:code},400);
    if(["rate_limited"].includes(code))return json({error:code},429);
    if(["funding_required"].includes(code))return json({error:code},402);
  }
  return json({error:"unavailable"},503);
};
function githubSource(env:Env){
  if(env.ENABLE_GITHUB_SOURCE!=="true"||!env.GITHUB_WEBHOOK_SECRET ||
     !env.GITHUB_SOURCE_REPOSITORIES||!env.GITHUB_SOURCE_BUYER_ID) {
    throw new AdapterError("unavailable","GitHub source not fully configured");
  }
  let repos:AllowedRepo[];
  try {
    const parsed:unknown=JSON.parse(env.GITHUB_SOURCE_REPOSITORIES);
    if(!Array.isArray(parsed) || parsed.length===0 || parsed.length>50)throw new Error("Repo allowlist size");
    repos=parsed as AllowedRepo[];
  } catch {throw new AdapterError("unavailable","GitHub repository allowlist invalid");}
  return createGitHubIssueSource({
    id:"github.source",secret:env.GITHUB_WEBHOOK_SECRET,repositories:repos,
    // Webhook intake only. GitHub App credentials are supplied separately for trusted outbound delivery.
    credentials:{tokenFor:async()=>{throw new AdapterError("unauthorized","Outbound GitHub delivery not wired to the public Worker");}},
  });
}
async function bodyUnderLimit(request:Request,max:number):Promise<Uint8Array>{
  const length=Number(request.headers.get("content-length")??"0");
  if(Number.isFinite(length)&&length>max)throw new AdapterError("invalid_input","Webhook exceeds size limit");
  if(!request.body)throw new AdapterError("invalid_input","Webhook has no body");
  const reader=request.body.getReader();
  const chunks:Uint8Array[]=[];
  let size=0;
  try {
    while(true){
      const {done,value}=await reader.read();
      if(done)break;
      size+=value.byteLength;
      if(size>max)throw new AdapterError("invalid_input","Webhook exceeds size limit");
      chunks.push(Uint8Array.from(value));
    }
  }finally{reader.releaseLock();}
  const out=new Uint8Array(size);
  let offset=0;
  for(const chunk of chunks){out.set(chunk,offset);offset+=chunk.byteLength;}
  return out;
}
async function hexDigest(body:Uint8Array):Promise<string>{
  const hash=new Uint8Array(await crypto.subtle.digest("SHA-256",Uint8Array.from(body)));
  return [...hash].map(x=>x.toString(16).padStart(2,"0")).join("");
}
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
<button id="approve" disabled>Approve exact terms</button>
<div id="disclosure" hidden>
<p class="warning">EXTERNAL DATA DISCLOSURE: the listed remote executor will receive the declared public inputs. Do not approve sensitive, proprietary or personal data.</p>
<label><input id="disclosure-check" type="checkbox" style="width:auto"/> I authorize sending these public inputs to the named remote test executor.</label>
<button id="consent-remote" disabled>Authorize external test execution</button>
</div>
<button id="fund" disabled>Simulate funding (localhost only)</button>
<p id="status"></p><small>On a real deployment, this screen must use OIDC authorization code + PKCE and an independently authenticated human session. Do not reuse an agent's credentials.</small>
<script>
const id=new URLSearchParams(location.search).get("work"),token=document.querySelector("#token"),
  status=document.querySelector("#status"),details=document.querySelector("#details");
let reviewedDigest="",disclosureDigest="";
function headers(){return {"authorization":"Bearer "+token.value,"content-type":"application/json"}}
async function read(){
 if(!id){status.textContent="Missing work ID";return}
 status.textContent="Loading private contract...";reviewedDigest="";disclosureDigest="";
 document.querySelector("#approve").disabled=true;
 document.querySelector("#consent-remote").disabled=true;
 document.querySelector("#disclosure").hidden=true;
 const r=await fetch("/api/review?work="+encodeURIComponent(id),{headers:headers(),cache:"no-store"});
 if(!r.ok){status.textContent="Authorization failed or work unavailable";return}
 const data=await r.json(),q=data.quote,w=data.work,s=data.state;
 const remote=data.remotePlan;
 reviewedDigest=q.termsDigest;
 details.replaceChildren();
 const pre=document.createElement("pre");pre.textContent=JSON.stringify({
  workId:w.id,offering:q.offeringId,scope:q.scope,
  amount:q.price,currency:q.price.currency,contractDigest:q.termsDigest,
  inputDigest:w.inputDigest,
  dataClassification:w.dataClassification??"internal",
  externalExecutor:remote?.origin??"Not enabled",
  externalExecutorId:remote?.executorId??null,
  externalDisclosureDigest:remote?.disclosureDigest??null,
  dataDisclosure:remote?"Public inline inputs will be sent to named remote TEST executor only":"No external transfer configured",
  state:s.status,approvedBy:s.approvedBy??null,funding:s.paymentRail??null
 },null,2);details.append(pre);
 document.querySelector("#approve").disabled=s.status!=="prepared_unfunded";
 if(remote){
   disclosureDigest=remote.disclosureDigest;
   document.querySelector("#disclosure").hidden=false;
   document.querySelector("#disclosure-check").checked=false;
   document.querySelector("#consent-remote").disabled=true;
   document.querySelector("#consent-remote").disabled=!["approved","funded"].includes(s.status);
   if(s.externalConsentDigest===disclosureDigest)
     document.querySelector("#consent-remote").textContent="Remote disclosure already authorized";
 }
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
document.querySelector("#consent-remote").onclick=async()=>{
 if(!disclosureDigest||!document.querySelector("#disclosure-check").checked||
    !confirm("Authorize sending the declared PUBLIC inputs to this named external test executor?"))return;
 const r=await fetch("/api/consent-external",{
   method:"POST",headers:headers(),
   body:JSON.stringify({workId:id,reviewedDigest:disclosureDigest}),
 });
 status.textContent=r.ok?"Exact remote disclosure recorded.":"External consent was rejected.";
 await read();
};
document.querySelector("#fund").onclick=async()=>{
 if(!confirm("SIMULATE funding with no real payment? Local sandbox only."))return;
 const r=await fetch("/api/dev/fund",{method:"POST",headers:headers(),body:JSON.stringify({workId:id})});
 status.textContent=r.ok?"Synthetic funding recorded; an authorized agent can now start the DEMO worker.":"Funding simulation rejected";
 await read();
};
</script></body></html>`;
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
  if(request.method==="GET"&&(url.pathname==="/"||url.pathname==="/connect")){
    return new Response(connectPage,{headers:{"content-type":"text/html;charset=UTF-8","cache-control":"no-store"}});
  }
  if(request.method==="GET"&&url.pathname==="/review"){
    return new Response(reviewPage,{headers:{"content-type":"text/html;charset=UTF-8","cache-control":"no-store",
      "content-security-policy":"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'",
      "referrer-policy":"no-referrer"}});
  }
  if(!allowedOrigin(request,env))return json({error:"origin_not_allowed"},403);
  if(url.pathname==="/api/artifacts/input"&&request.method==="POST"){
    if(env.ENABLE_MODBUS_PCAP!=="true")return json({error:"not_found"},404);
    try{
      const actor=requireScope(await principal(request,env,"mcp"),"work:prepare");
      if(request.headers.get("content-type")?.split(";")[0]!==PCAP_MEDIA_TYPE ||
         request.headers.get("x-awc-data-classification")!=="public"){
        return json({error:"public_classic_pcap_only"},415);
      }
      const raw=await bodyUnderLimit(request,MAX_CAPTURE_BYTES);
      await analyzeClassicPcap(raw);
      const custody=artifactCustody(env);
      if(!custody)return json({error:"private_r2_not_configured"},503);
      const stored=await custody.putInput(actor.buyerId,raw);
      return json({...stored,declaredDataClassification:"public",
        warning:"Upload only captures explicitly cleared for outside disclosure. Bytes are retained in private R2."},201);
    }catch(error){return errorResponse(error);}
  }
  if(url.pathname.startsWith("/api/artifacts/results/")&&request.method==="GET"){
    try{
      const actor=requireScope(await principal(request,env,"mcp"),"work:read");
      const pieces=url.pathname.split("/");
      if(pieces.length!==6) return json({error:"invalid_artifact_path"},400);
      const workId=pieces[4]!,digest=pieces[5]!;
      if(!/^work_[a-f0-9-]{36}$/.test(workId)||!/^[a-f0-9]{64}$/.test(digest))
        return json({error:"invalid_artifact_reference"},400);
      const {commerce,custody}=services(env,request);
      if(!custody)return json({error:"private_r2_not_configured"},503);
      const preview=await Effect.runPromise(commerce.preview(actor.buyerId,workId));
      const artifact=preview.state.result?.artifacts.find(x=>
        x.reference==="artifact:sha256:"+digest && x.sha256===digest &&
        ["application/json","application/jose"].includes(x.mediaType));
      if(!artifact)return json({error:"artifact_not_in_completed_work"},404);
      const bytes=await custody.readOutput(actor.buyerId,workId,artifact.reference!);
      return new Response(Uint8Array.from(bytes).buffer,{headers:{
        "content-type":artifact.mediaType,
        "cache-control":"no-store","x-content-type-options":"nosniff",
        "content-disposition":'attachment; filename="awc-artifact-'+digest.slice(0,12)+'"',
      }});
    }catch(error){return errorResponse(error);}
  }
  if(url.pathname==="/integrations/github/webhook" && request.method==="POST"){
    if(env.ENABLE_GITHUB_SOURCE!=="true")return json({error:"not_found"},404);
    try{
      const source=githubSource(env);
      const raw=await bodyUnderLimit(request,256_000);
      const result=await Effect.runPromise(source.ingest({
        body:raw,headers:Object.fromEntries(request.headers.entries()),
      }));
      if(result.type==="ignored")return json({
        accepted:true,kind:"ignored",reason:result.reason,
      },202);
      const inbox=d1SourceInbox(env.DB);
      const record=await inbox.record(
        env.GITHUB_SOURCE_BUYER_ID!,result.opportunity,await hexDigest(raw));
      // No billing, bidding, work-start, or external API writes in this ingress route.
      return json({accepted:true,kind:"opportunity",opportunityId:record.opportunityId,
        duplicate:record.duplicate,commercialStatus:"not_authorized"},202);
    }catch(error){return errorResponse(error);}
  }
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
      const {commerce,remoteDispatcher}=services(env,request);
      const preview=await Effect.runPromise(commerce.preview(actor.buyerId,workId));
      let remotePlan:unknown=null;
      if(remoteDispatcher?.appliesTo(preview.work.offeringId)){
        try {remotePlan=await Effect.runPromise(remoteDispatcher.plan(actor.buyerId,workId));}
        catch {remotePlan=null;}
      }
      return json({...preview,remotePlan});
    }catch(e){return errorResponse(e);}
  }
  if(["/api/approve","/api/dev/fund","/api/consent-external"].includes(url.pathname)&&request.method==="POST"){
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
      if(url.pathname==="/api/consent-external"){
        const {remoteDispatcher}=services(env,request);
        if(!remoteDispatcher)return json({error:"external_dispatch_disabled"},403);
        const plan=await Effect.runPromise(remoteDispatcher.plan(actor.buyerId,payload.workId));
        if(plan.disclosureDigest!==payload.reviewedDigest)
          return json({error:"disclosure_contract_mismatch"},409);
        return json(await Effect.runPromise(commerce.consentExternal(actor.buyerId,payload.workId,{
          buyerId:actor.buyerId,approverSubject:actor.subject,
          reviewedDigest:payload.reviewedDigest,ceremony:actor.ceremony!,
        })));
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
    const {marketplace,commerce,stripe,remoteDispatcher,custody}=services(env,request);
    const ui=await env.ASSETS.fetch("https://assets.local/marketplace.html");
    const contractUi=await env.ASSETS.fetch("https://assets.local/contract.html");
    const paid=paidConfig(env);
    // Load static App bundles once and provide the strings to the stateless MCP factory.
    const [html,contract]=await Promise.all([ui.ok?ui.text():Promise.resolve(""),contractUi.ok?contractUi.text():Promise.resolve("")]);
    const configured=createMcpHandler(()=>createCatalogMcpServer({
      marketplace,commerce,buyerId:actor?.kind==="agent"?actor.buyerId:null,
      buyerScopes:actor?.scopes??[],approvalBaseUrl:url.origin,
      appHtml:html,contractAppHtml:contract,
      ...(env.AWC_JOBS ? {enqueue:async (msg:WorkRunMessage)=>{await env.AWC_JOBS!.send(msg);}} : {}),
      stripeCheckoutAvailable:!!stripe,
      ...(remoteDispatcher?{remoteDispatcher}:{}),
      ...(custody?{readCompletedArtifact:async(buyerId:string,workId:string,ref:string)=>{
        const preview=await Effect.runPromise(commerce.preview(buyerId,workId));
        if(preview.state.status!=="submitted")throw new AdapterError("unauthorized","Work not submitted");
        const artifact=preview.state.result?.artifacts.find(x=>x.reference===ref&&
          x.sha256===ref.slice("artifact:sha256:".length));
        if(!artifact)throw new AdapterError("not_found","Artifact not bound to buyer's submitted work");
        const bytes=await custody.readOutput(buyerId,workId,ref);
        if(artifact.mediaType==="application/json"){
          return {ref,mediaType:artifact.mediaType,value:JSON.parse(new TextDecoder().decode(bytes)) as unknown,
            integrityVerified:true};
        }
        if(artifact.mediaType==="application/jose"&&env.AWC_ATTEST_PUBLIC_KEY_PEM &&
           env.AWC_ATTEST_KEY_ID&&env.AWC_ATTEST_OBSERVATION_ISSUER){
          const observation=await verifyObservation(new TextDecoder().decode(bytes),{
            issuerId:env.AWC_ATTEST_OBSERVATION_ISSUER,keyId:env.AWC_ATTEST_KEY_ID,
            publicKeyPem:env.AWC_ATTEST_PUBLIC_KEY_PEM,
            workId,contractDigest:preview.quote.termsDigest,
          });
          return {ref,mediaType:artifact.mediaType,value:observation,
            integrityVerified:true,signatureVerified:true,
            issuerAuthority:"Not independently established: local observation issuer only"};
        }
        throw new AdapterError("unauthorized","Unsupported or untrusted artifact type");
      }}:{}),
      ...(env.ENABLE_GITHUB_SOURCE==="true" && env.GITHUB_SOURCE_BUYER_ID
        ? {listOpportunities:async (buyerId:string,limit:number)=>{
          if(buyerId!==env.GITHUB_SOURCE_BUYER_ID)return [];
          return d1SourceInbox(env.DB).list(buyerId,limit);
        }} : {}),
      ...(paid?{paidSandbox:paid}:{}),
    }),{route:"/mcp",corsOptions:false});
    return configured(request,env,ctx);
  }catch(e){return errorResponse(e);}
}

export async function consumeWorkQueue(batch:MessageBatch<unknown>,env:Env):Promise<void>{
  const request=new Request("https://awc.internal/health");
  const {commerce,remoteDispatcher}=services(env,request);
  for(const msg of batch.messages){
    try{
      const candidate:unknown=msg.body;
      if(!candidate || typeof candidate!=="object" || Array.isArray(candidate)){msg.ack();continue;}
      const payload=candidate as {workId?:unknown;buyerId?:unknown};
      if(typeof payload.workId!=="string"||typeof payload.buyerId!=="string"||
         payload.workId.length>160||payload.buyerId.length>200){msg.ack();continue;}
      if(remoteDispatcher){
        const preview=await Effect.runPromise(commerce.preview(payload.buyerId,payload.workId));
        if(remoteDispatcher.appliesTo(preview.work.offeringId)){
          await Effect.runPromise(remoteDispatcher.advance(payload.buyerId,payload.workId));
          msg.ack();continue;
        }
      }
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
  const {commerce,remoteDispatcher}=services(env,new Request("https://awc.internal/health"));
  for(const message of await Effect.runPromise(commerce.recoverable())){
    await env.AWC_JOBS.send(message);
  }
  if(remoteDispatcher){
    for(const message of await Effect.runPromise(remoteDispatcher.recoverable())){
      await env.AWC_JOBS.send(message);
    }
  }
}
export default {
  fetch:handleRequest,
  queue:consumeWorkQueue,
  scheduled:async(_event:ScheduledController,env:Env,_ctx:ExecutionContext)=>recoverQueued(env),
} satisfies ExportedHandler<Env>;
