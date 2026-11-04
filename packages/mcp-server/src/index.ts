import { Effect } from "effect";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/server";
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { withX402 } from "agents/x402";
import { z } from "zod/v4";
import { MarketplaceError, type Marketplace } from "@awc/marketplace";
import { CommerceError, type Commerce, type WorkRunMessage } from "@awc/commerce";
import { SCENARIOS, runScenario } from "@awc/simulations";
import { runStandardsScenario } from "@awc/standards-demo";
import type { StoredOpportunity } from "@awc/source-inbox";
import type { TrustedDispatcher } from "@awc/dispatch";
import { listTcpServiceProfiles } from "@awc/offering-profiles";
import { listCandidateDomains } from "@awc/domain-opportunities";

export const MARKETPLACE_APP_URI = "ui://awc/marketplace.html";
export const CONTRACT_APP_URI = "ui://awc/contract.html";
export const OPERATIONS_APP_URI = "ui://awc/operations.html";
export const TCP_REPORT_APP_URI = "ui://awc/tcp-report.html";
export interface PaidSandboxConfig {
  readonly network: "base-sepolia";
  readonly recipient: `0x${string}`;
  readonly facilitatorUrl: string;
}
export interface McpServerConfig {
  readonly marketplace: Marketplace;
  readonly buyerId: string | null;
  readonly buyerScopes?: readonly string[];
  readonly appHtml: string;
  readonly contractAppHtml?: string;
  readonly operationsAppHtml?: string;
  readonly tcpReportAppHtml?: string;
  readonly approvalBaseUrl?: string;
  readonly commerce?: Commerce;
  readonly enqueue?: (work:WorkRunMessage)=>Promise<void>;
  readonly stripeCheckoutAvailable?: boolean;
  readonly remoteDispatcher?: TrustedDispatcher;
  readonly readCompletedArtifact?: (buyerId:string,workId:string,ref:string)=>Promise<{
    ref:string;mediaType:string;value:unknown;integrityVerified:boolean;
    signatureVerified?:boolean;issuerAuthority?:string;
  }>;
  readonly paidSandbox?: PaidSandboxConfig;
  /** Authorized buyer-scoped work from verified sources; never automatically funded. */
  readonly listOpportunities?: (buyerId: string, limit: number) => Promise<readonly StoredOpportunity[]>;
}

const reply = (value:Record<string,unknown>,message:string) => ({
  content:[{type:"text" as const,text:message}],
  structuredContent:value,
});
const failure=(unknown:unknown)=>{
  const err=unknown instanceof MarketplaceError||unknown instanceof CommerceError ? unknown : null;
  return {isError:true as const,content:[{
    type:"text" as const,text:err?err.code+": "+err.message:"unavailable: Unable to complete request",
  }]};
};
async function guarded<T extends object>(effect:Effect.Effect<T,any>,summary:(value:T)=>string){
  try {
    const value=await Effect.runPromise(effect);
    return reply(value as Record<string,unknown>,summary(value));
  }catch(err){return failure(err);}
}
export function createCatalogMcpServer(config:McpServerConfig):McpServer {
  const server=new McpServer({name:"Agent Work Catalog",version:"0.2.0"});
  const scope=(name:string)=>!!config.buyerId&&!!config.buyerScopes?.includes(name);
  const reviewUrl=(id:string)=>config.approvalBaseUrl
    ? new URL("/review?work="+encodeURIComponent(id),config.approvalBaseUrl).toString()
    : undefined;

  registerAppTool(server,"catalog.search",{
    description:"Find purchasable work by desired outcome. Demo results are fictional, not verified providers.",
    inputSchema:z.object({
      intent:z.string().min(3).max(2000),
      currency:z.string().max(10).optional(),
      maxPriceMinor:z.string().regex(/^(0|[1-9][0-9]*)$/).optional(),
      inputMediaType:z.string().max(120).optional(),
      outputMediaType:z.string().max(120).optional(),
      limit:z.number().int().min(1).max(20).optional(),
    }).strict(),
    annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:true},
    _meta:{ui:{resourceUri:MARKETPLACE_APP_URI}},
  },async(args)=>guarded(config.marketplace.search(args),x=>
    "Found "+x.matches.length+" illustrative offerings. No payment required."));

  server.registerTool("catalog.get_offering",{
    description:"Inspect a fictional, versioned commercial offering and its task type.",
    inputSchema:z.object({offeringId:z.string().min(3).max(180)}).strict(),
    annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true},
  },async({offeringId})=>guarded(config.marketplace.getOffering(offeringId),
    x=>"Illustrative offering: "+x.offering.title));

  server.registerTool("catalog.list_tcp_services",{
    description:"Explore the versioned TCP/OT service family, its evidence contracts and example pricing. Only pilot-test-only profiles have a sandbox implementation; other tiers are NOT purchasable.",
    inputSchema:z.object({}).strict(),
    annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true},
  },async()=>reply({
    kind:"awc.tcp-service-catalog/v1",actualBillingEnabled:false,
    profiles:listTcpServiceProfiles(),
    note:"Illustrative prices, no market validation. Planned profiles cannot be ordered.",
  },"Nine TCP/OT service profiles, explicitly marked pilot or planned. No real payments."));

  server.registerResource("TCP/OT service profiles","awc://catalog/tcp-service-tiers",{
    description:"Public versioned service taxonomy with implementation readiness and outcome evidence requirements.",
    mimeType:"application/json",
  },async(uri)=>({contents:[{
    uri:uri.href,mimeType:"application/json",
    text:JSON.stringify({version:"awc.tcp-service-catalog/v1",profiles:listTcpServiceProfiles()}),
  }]}));

  server.registerTool("catalog.list_domain_opportunities",{
    description:"Explore twelve research-only agent work domains with concrete sources, execution pipelines, deliverables, verification criteria and illustrative pricing. None are currently purchasable.",
    inputSchema:z.object({}).strict(),
    annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true},
  },async()=>reply({
    kind:"awc.domain-opportunities/v1",readiness:"design-only",
    opportunities:listCandidateDomains(),actualBillingEnabled:false,
  },"Twelve design-only domain opportunities, not executable or priced live listings."));

  server.registerResource("Agent work opportunity map","awc://catalog/domain-opportunities",{
    description:"Research-only work domains and measurable output contracts",
    mimeType:"application/json",
  },async(uri)=>({contents:[{
    uri:uri.href,mimeType:"application/json",
    text:JSON.stringify({schema:"awc.domain-opportunities/v1",items:listCandidateDomains()}),
  }]}));

  for (const [name,uri,html] of [
    ["Marketplace Explorer",MARKETPLACE_APP_URI,config.appHtml],
    ["Contract Review",CONTRACT_APP_URI,config.contractAppHtml??""],
    ["Operations Sandbox",OPERATIONS_APP_URI,config.operationsAppHtml??""],
    ["TCP Evidence Inspector",TCP_REPORT_APP_URI,config.tcpReportAppHtml??""],
  ] as const){
    registerAppResource(server,name,uri,{
      description:name+" interface, optional in clients without MCP Apps",
      mimeType:RESOURCE_MIME_TYPE,
    },async()=>({contents:[{
      uri,mimeType:RESOURCE_MIME_TYPE,
      text:html||"<!doctype html><html><body>Build the MCP App assets first.</body></html>",
    }]}));
  }

  server.registerResource("Catalog manifest","awc://catalog/manifest",{
    title:"AWC public demo catalog",mimeType:"application/json",
  },async(uri)=>({contents:[{uri:uri.href,mimeType:"application/json",
    text:JSON.stringify({schemaVersion:"awc-catalog/v0.2",catalog:"seeded-demo-only",
      publicTools:["catalog.search","catalog.get_offering"],payments:"disabled-unless-tested"})}]}));

  server.registerResource("Versioned offering",new ResourceTemplate("awc://offerings/{slug}/{version}",{
    list:undefined,
  }),{description:"Read a public offering and canonical task definition",mimeType:"application/json"},
  async(uri,vars)=>{
    const match=await Effect.runPromise(config.marketplace.getOffering("offering:"+String(vars.slug)));
    if(String(vars.version)!==match.offering.version)throw new Error("Offering version unknown");
    return {contents:[{uri:uri.href,mimeType:"application/json",text:JSON.stringify(match)}]};
  });


  // Three bounded, completely in-memory simulations. Never route to OT, public cloud,
  // payment signers or production WorkOrders. These are NOT physical-control tools.
  server.registerTool("operations.scenarios",{
    description:"List fictional operating environments used to test delegated responsibility. No real actions.",
    inputSchema:z.object({}).strict(),
    annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false},
  },async()=>reply({mode:"strictly-simulated",scenarios:SCENARIOS},
    "Three synthetic operations are available: vending, cloud and production cell."));

  registerAppTool(server,"operations.simulate",{
    description:"Run an isolated simulation of mandate, budget and safety checks. No external calls, billing or physical control.",
    inputSchema:z.object({scenario:z.enum(["vending","cloud","plant"])}).strict(),
    annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false},
    _meta:{ui:{resourceUri:OPERATIONS_APP_URI}},
  },async({scenario})=>guarded(runScenario(scenario),report=>
    "DEMO ONLY: "+report.scenario+" evaluated "+report.attemptedActions.length+
    " proposals; no real machine, cloud resource or payment was touched."));

  server.registerResource("Operations simulation catalog","awc://operations/scenarios",{
    title:"AWC operating responsibility simulation definitions",
    mimeType:"application/json",
  },async(uri)=>({contents:[{uri:uri.href,mimeType:"application/json",
    text:JSON.stringify({schemaVersion:"awc.simulation/v1",mode:"strictly-simulated",scenarios:SCENARIOS})}]}));


  // Read-only interoperability export; no authority, credentials or side effects are
  // created by the returned policy documents.
  server.registerTool("operations.standards",{
    description:"Export a synthetic operating scenario as AuthZEN, ODRL, CloudEvents, PROV-O and OpenSLO; optional OSB/UBL previews. NO live actions.",
    inputSchema:z.object({scenario:z.enum(["vending","cloud","plant"])}).strict(),
    annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false},
  },async({scenario})=>guarded(Effect.tryPromise({
    try:()=>runStandardsScenario(scenario),
    catch:()=>new Error("Standards fixture failed")
  }),r=>"DEMO ONLY: mapped "+r.scenario+" into "+
    r.authzen.length+" AuthZEN requests, "+r.cloudevents.length+
    " CloudEvents, and "+r.provenance.length+" PROV-O graphs."));

  server.registerResource("AWC supported standards","awc://standards/manifest",{
    title:"AWC Interoperability Test Manifest",mimeType:"application/json",
  },async(uri)=>({contents:[{uri:uri.href,mimeType:"application/json",text:JSON.stringify({
    mode:"strictly-simulated",
    packages:["authzen-1.0","odrl-2.2-awc-profile","coaz-mcp-draft-subset",
      "cloudevents-1.0","prov-o","openslo-v1","oauth-rar-9396-action","epcis-2.0-object-event",
      "osb-2.17-preview","ubl-2.4-xml-subset"],
    tool:"operations.standards",
    productionConformance:false
  })}]}));

  const buyerId=config.buyerId;
  if(buyerId&&scope("quotes:write")){
    server.registerTool("quotes.request",{
      description:"Create an exact sample fixed-price quote. NO PAYMENT is taken.",
      inputSchema:z.object({
        offeringId:z.string().min(3).max(180),scope:z.string().min(8).max(2000),
        idempotencyKey:z.string().min(8).max(100),
        maxPriceMinor:z.string().regex(/^(0|[1-9][0-9]*)$/).optional(),
      }).strict(),
      annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:true},
    },async(args)=>guarded(config.marketplace.requestQuote(buyerId,args),
      q=>"Quote "+q.id+" proposed; no money or permission to execute."));
  }
  if(buyerId&&scope("work:prepare")){
    registerAppTool(server,"work.prepare",{
      description:"Prepare UNFUNDED work under an existing quote. Opens a separate human-facing review.",
      inputSchema:z.object({
        quoteId:z.string().min(3).max(150),
        dataClassification:z.enum(["public","internal","confidential"]).optional(),
        idempotencyKey:z.string().min(8).max(100),
        inputs:z.array(z.object({
          name:z.string().min(1).max(100),mediaType:z.string().min(3).max(120),
          kind:z.enum(["inline","reference"]),data:z.unknown().optional(),
          reference:z.string().optional(),sha256:z.string().optional(),
        }).strict()).min(1).max(10),
      }).strict(),
      annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:true},
      _meta:{ui:{resourceUri:CONTRACT_APP_URI}},
    },async(args)=>{
      const prepare=config.marketplace.prepareWork(buyerId,{
        quoteId:args.quoteId,idempotencyKey:args.idempotencyKey,
        ...(args.dataClassification!==undefined ? {dataClassification:args.dataClassification} : {}),
        inputs:args.inputs.map(i=>({
          name:i.name,mediaType:i.mediaType,kind:i.kind,
          ...(i.data!==undefined?{data:i.data}:{}),
          ...(i.reference!==undefined?{reference:i.reference}:{}),
          ...(i.sha256!==undefined?{sha256:i.sha256}:{}),
        })),
      });
      try{
        const work=await Effect.runPromise(prepare);
        const quote=await Effect.runPromise(config.marketplace.getQuote(buyerId,work.quoteId));
        return reply({...work,quote,reviewUrl:reviewUrl(work.id)},
          "Work "+work.id+" is UNFUNDED. The human must review terms outside the agent before payment.");
      }catch(error){return failure(error);}
    });
  }
  if(buyerId&&scope("work:read")&&config.listOpportunities){
    server.registerTool("work.opportunities.list",{
      description:"List verified incoming work OPPORTUNITIES, not contracts or authorized executions.",
      inputSchema:z.object({limit:z.number().int().min(1).max(20).optional()}).strict(),
      annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true},
    },async({limit})=>{
      try {
        const records=await config.listOpportunities!(buyerId,limit??10);
        return reply({
          kind:"awc.opportunities/v1",source:"authenticated-inbox",
          opportunities:records.map(({opportunity})=>({
            id:opportunity.id,title:opportunity.title,
            descriptionPreview:opportunity.description.slice(0,500),
            status:opportunity.status,sourceId:opportunity.external.sourceId,
            originUrl:opportunity.external.originUrl,observedAt:opportunity.observedAt,
            commercialStatus:"not_authorized",
          })),
        },"Received "+records.length+" potential assignments. None are authorized WorkOrders.");
      } catch(error) { return failure(error); }
    });
  }
  if(buyerId&&scope("work:read")){
    server.registerTool("work.get",{
      description:"Read this buyer's work and any approval, funding, execution status. Not an MCP Task.",
      inputSchema:z.object({workId:z.string().min(3).max(160)}).strict(),
      annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true},
    },async({workId})=>{
      try {
        const work=await Effect.runPromise(config.marketplace.getWork(buyerId,workId));
        const quote=await Effect.runPromise(config.marketplace.getQuote(buyerId,work.quoteId));
        const commerce=config.commerce
          ? (await Effect.runPromise(config.commerce.preview(buyerId,workId))).state
          : undefined;
        const dispatch=config.remoteDispatcher?.appliesTo(work.offeringId)
          ? await Effect.runPromise(config.remoteDispatcher.get(buyerId,workId)) : null;
        const remoteStatus=dispatch?{
          status:dispatch.status,executorId:dispatch.executorId,
          providerExecutionId:dispatch.handle?.providerExecutionId??null,
          resultDigest:dispatch.resultDigest??null,
          updatedAt:dispatch.updatedAt,lastError:dispatch.lastError??null,
        }:null;
        return reply({...work,quote,commerce,remoteStatus,reviewUrl:reviewUrl(work.id)},
          "Work "+work.id+" is "+(commerce?.status??work.state));
      }catch(error){return failure(error);}
    });

    server.registerResource("Private work order",new ResourceTemplate("awc://work-orders/{workId}",{
      list:undefined,
    }),{description:"Buyer-private work state and exact quote terms",mimeType:"application/json"},
    async(uri,vars)=>{
      const work=await Effect.runPromise(config.marketplace.getWork(buyerId,String(vars.workId)));
      const quote=await Effect.runPromise(config.marketplace.getQuote(buyerId,work.quoteId));
      const commerce=config.commerce
        ? (await Effect.runPromise(config.commerce.preview(buyerId,work.id))).state
        : undefined;
      const dispatch=config.remoteDispatcher?.appliesTo(work.offeringId)
        ? await Effect.runPromise(config.remoteDispatcher.get(buyerId,work.id)) : null;
      return {contents:[{uri:uri.href,mimeType:"application/json",text:JSON.stringify({
        work,quote,commerce,remoteStatus:dispatch?{
          status:dispatch.status,executorId:dispatch.executorId,
          providerExecutionId:dispatch.handle?.providerExecutionId??null,
          resultDigest:dispatch.resultDigest??null,
        }:null,
      })}]};
    });
  }
  if(buyerId&&scope("work:read")&&config.readCompletedArtifact){
    registerAppTool(server,"work.artifacts.read",{
      description:"Read and verify a buyer-scoped completed JSON artifact or broker-signed observation from private R2. No arbitrary URLs.",
      inputSchema:z.object({
        workId:z.string().regex(/^work_[a-f0-9-]{36}$/),
        artifactRef:z.string().regex(/^artifact:sha256:[a-f0-9]{64}$/),
      }).strict(),
      annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true},
      _meta:{ui:{resourceUri:TCP_REPORT_APP_URI}},
    },async({workId,artifactRef})=>{
      try{
        const item=await config.readCompletedArtifact!(buyerId,workId,artifactRef);
        return reply(item,
          "Verified buyer-scoped "+item.mediaType+" artifact. "+
          (item.signatureVerified?"Observation signature valid; issuer authority not independently assessed.":"Content SHA-256 matched."));
      }catch{return failure(new MarketplaceError("not_found","Completed artifact unavailable or failed integrity verification"));}
    });
  }
  if(buyerId&&scope("billing:checkout")){
    server.registerTool("billing.options",{
      description:"List safe available payment methods. No authorization or charge is performed.",
      inputSchema:z.object({}).strict(),
      annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true},
    },async()=>reply({
      stripeTestMode:!!config.stripeCheckoutAvailable,
      x402RealMoney:false,credits:false,canStartWithoutFunding:false,
      message:"Card checkout requires separately reviewed contract. Test mode only.",
    },"No live-money payment rail is enabled."));

    if(config.commerce&&config.stripeCheckoutAvailable){
      server.registerTool("billing.checkout",{
        description:"Create a Stripe TEST Checkout URL only AFTER separately authenticated human approval.",
        inputSchema:z.object({workId:z.string().min(3).max(160)}).strict(),
        annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:true},
      },async({workId})=>guarded(config.commerce!.checkout(buyerId,workId),r=>
        "Hosted Stripe TEST checkout ready. It will not authorize execution until settlement is verified."));
      server.registerTool("billing.reconcile",{
        description:"Re-query Stripe TEST settlement for an approved work order. Cannot mark arbitrary payments as verified.",
        inputSchema:z.object({workId:z.string().min(3).max(160)}).strict(),
        annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:true},
      },async({workId})=>guarded(config.commerce!.reconcileStripe(buyerId,workId),
        r=>"Stripe TEST funding state: "+r.status));
    }
  }
  if(buyerId&&scope("work:execute")&&config.commerce&&config.enqueue){
    server.registerTool("work.start",{
      description:"Enqueue an approved AND independently funded work order. This sandbox runs synthetic work only.",
      inputSchema:z.object({workId:z.string().min(3).max(160)}).strict(),
      annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:true},
    },async({workId})=>{
      try {
        const scheduled=await Effect.runPromise(config.commerce!.start(buyerId,workId));
        if(scheduled.enqueue) await config.enqueue!({buyerId,workId});
        return reply({workId,status:scheduled.state.status,executionTransport:"Cloudflare Queue",
          paymentRail:scheduled.state.paymentRail??"none"},
          "Work order "+workId+" queued for a synthetic sandbox executor.");
      }catch(error){return failure(error);}
    });
  }

  // This is a separate, explicitly opted-in TESTNET paid-tool experiment.
  if(config.paidSandbox){
    const paid=withX402(server,{
      network:config.paidSandbox.network,
      recipient:config.paidSandbox.recipient,
      facilitator:{url:config.paidSandbox.facilitatorUrl},
    });
    paid.paidTool("sandbox.paid_text_stats","Base Sepolia TESTNET only; $0.01 deterministic text counts",0.01,
      {text:z.string().min(1).max(500)},
      {readOnlyHint:true,destructiveHint:false,idempotentHint:true},
      async({text})=>reply({characters:text.length,words:text.trim().split(/\s+/).length,
        mode:"base-sepolia-testnet"},"Text counted in testnet sandbox."));
  }
  return server;
}
