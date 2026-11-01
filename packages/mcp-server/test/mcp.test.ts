import { describe, expect, it } from "vitest";
import { Client, InMemoryTransport, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { makeMarketplace, inMemoryMarketplaceStore } from "@awc/marketplace";
import { makeCommerce, sandboxExecutor, type WorkRunMessage, type WorkSnapshot, type WorkStateStore } from "@awc/commerce";
import { Effect } from "effect";
import { createCatalogMcpServer, MARKETPLACE_APP_URI, CONTRACT_APP_URI } from "../src/index.ts";

async function fixture(authenticated: boolean) {
  const marketplace = makeMarketplace(inMemoryMarketplaceStore());
  const server = createCatalogMcpServer({marketplace,buyerId:authenticated?"buyer-1":null,
    buyerScopes:authenticated?["quotes:write","work:prepare","work:read","billing:checkout"]:[],
    approvalBaseUrl:"https://awc.example",contractAppHtml:"<!doctype html><html>Secure terms</html>",appHtml:"<!doctype html><html><body>Sample catalog app</body></html>"});
  const client = new Client({name:"awc-test",version:"0.1.0"});
  const [a,b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(b),client.connect(a)]);
  return {client,server,close:async()=>{await client.close();await server.close();}};
}
describe("AWC MCP server", () => {

  it("refuses MCP execution until separately approved and funded, then queues once",async()=>{
    const marketplace=makeMarketplace(inMemoryMarketplaceStore());
    const records=new Map<string,WorkSnapshot>();
    const store:WorkStateStore={
      initialize:async(work,now)=>{
        const prev=records.get(work.id);
        if(prev)return prev;
        const state:WorkSnapshot={id:work.id,buyerId:work.buyerId,quoteDigest:work.quoteDigest,
          status:"prepared_unfunded",version:0,attempts:0,updatedAt:now};
        records.set(work.id,state);return state;
      },
      get:async(buyer,id)=>{
        const state=records.get(id);return state?.buyerId===buyer?state:undefined;
      },
      cas:async(before,after)=>{
        const old=records.get(before.id);
        if(!old||old.version!==before.version)return false;
        records.set(before.id,after);return true;
      },
      recoverable:async()=>[],
    };
    const commerce=makeCommerce(marketplace,store,sandboxExecutor,{enableSandboxFunding:true});
    const queue:WorkRunMessage[]=[];
    const server=createCatalogMcpServer({
      marketplace,commerce,buyerId:"buyer-1",
      buyerScopes:["quotes:write","work:prepare","work:read","work:execute","billing:checkout"],
      appHtml:"<!doctype html><html>Marketplace</html>",
      contractAppHtml:"<!doctype html><html>Contract</html>",
      approvalBaseUrl:"https://awc.example",
      enqueue:async(message)=>{queue.push(message);},
    });
    const client=new Client({name:"commerce-mcp-test",version:"0.2.0"});
    const [a,b]=InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(b),client.connect(a)]);
    try{
      const q=await client.callTool({name:"quotes.request",arguments:{
        offeringId:"offering:oauth-audit",scope:"Analyze OAuth token handling and report vulnerabilities",
        idempotencyKey:"quote_commerce_test_001",
      }});
      const quote=q.structuredContent as {id:string;termsDigest:string};
      const w=await client.callTool({name:"work.prepare",arguments:{
        quoteId:quote.id,idempotencyKey:"work_commerce_test_001",
        inputs:[{name:"observations",mediaType:"text/plain",kind:"inline",data:"OAuth scope design review"}],
      }});
      const order=w.structuredContent as {id:string;reviewUrl:string};
      expect(order.reviewUrl).toContain("/review?work=");
      expect((await client.callTool({name:"work.start",arguments:{workId:order.id}})).isError).toBe(true);
      expect(queue).toHaveLength(0);

      await Effect.runPromise(commerce.approve("buyer-1",order.id,{
        buyerId:"buyer-1",approverSubject:"authenticated-human",ceremony:"local-sandbox-only",
        reviewedDigest:quote.termsDigest,
      }));
      expect((await client.callTool({name:"work.start",arguments:{workId:order.id}})).isError).toBe(true);
      await Effect.runPromise(commerce.sandboxFund("buyer-1",order.id));
      const started=await client.callTool({name:"work.start",arguments:{workId:order.id}});
      expect(started.isError).not.toBe(true);
      await client.callTool({name:"work.start",arguments:{workId:order.id}});
      expect(queue).toHaveLength(1);
      await Effect.runPromise(commerce.runQueued(queue[0]!));
      const result=await client.callTool({name:"work.get",arguments:{workId:order.id}});
      const state=result.structuredContent as {commerce:{status:string;result?:unknown}};
      expect(state.commerce.status).toBe("submitted");
      expect(state.commerce.result).toBeDefined();
    }finally{await client.close();await server.close();}
  });


  it("exposes simulated operating mandates with separate commercial and safety outcomes",async()=>{
    const f=await fixture(false);
    try{
      const list=await f.client.listTools();
      expect(list.tools.some(t=>t.name==="operations.simulate")).toBe(true);
      expect(list.tools.some(t=>t.name==="mandates.activate")).toBe(false);
      const result=await f.client.callTool({name:"operations.simulate",arguments:{scenario:"plant"}});
      expect(result.isError).not.toBe(true);
      const report=result.structuredContent as {
        mode:string;attemptedActions:{status:string}[];account:{spentMinor:string};
      };
      expect(report.mode).toBe("strictly-simulated");
      expect(report.attemptedActions.map(a=>a.status)).toEqual(["simulated","escalated","denied"]);
      expect(report.account.spentMinor).toBe("0");
      const resource=await f.client.readResource({uri:"awc://operations/scenarios"});
      expect(resource.contents.length).toBeGreaterThan(0);
    }finally{await f.close();}
  });

  it("serves the modern 2026-07-28 stateless HTTP protocol without sockets", async () => {
    const marketplace = makeMarketplace(inMemoryMarketplaceStore());
    const handler = createMcpHandler(() => createCatalogMcpServer({
      marketplace, buyerId: null, appHtml: "<!doctype html><html>Test UI</html>",
    }));
    const transport = new StreamableHTTPClientTransport(new URL("http://test.local/mcp"), {
      fetch: (url, init) => handler.fetch(new Request(url, init)),
    });
    const client = new Client({ name:"awc-http-test",version:"0.1.0" }, {
      versionNegotiation:{mode:"auto"},
    });
    try {
      await client.connect(transport);
      expect(client.getNegotiatedProtocolVersion()).toBe("2026-07-28");
      const search = await client.callTool({ name:"catalog.search",arguments:{intent:"Modbus timeout diagnostics"} });
      expect((search.structuredContent as {matches:unknown[]}).matches.length).toBeGreaterThan(0);
    } finally {
      await client.close();
      await handler.close();
    }
  });

  it("exposes free read tools and MCP App resource to signed-out clients", async () => {
    const f=await fixture(false);
    try {
      const list=await f.client.listTools();
      expect(list.tools.some(t=>t.name==="catalog.search")).toBe(true);
      expect(list.tools.some(t=>t.name==="quotes.request")).toBe(false);
      expect(list.tools.some(t=>t.name==="sandbox.paid_text_stats")).toBe(false);
      const result=await f.client.callTool({name:"catalog.search",arguments:{intent:"OAuth security audit"}});
      expect((result.structuredContent as {matches:unknown[]}).matches.length).toBeGreaterThan(0);
      const app=await f.client.readResource({uri:MARKETPLACE_APP_URI});
      const appContent = app.contents[0];
      expect(appContent && "text" in appContent ? appContent.text : "").toContain("Sample catalog app");
      const resources=await f.client.listResources();
      expect(resources.resources.some(x=>x.uri==="awc://catalog/manifest")).toBe(true);
    } finally {await f.close();}
  });
  it("quotes and prepares work without authorizing payment or execution", async () => {
    const f=await fixture(true);
    try {
      const list=await f.client.listTools();
      expect(list.tools.some(t=>t.name==="work.prepare")).toBe(true);
      const quote=await f.client.callTool({name:"quotes.request",arguments:{
        offeringId:"offering:modbus-report",scope:"Explain repeated Modbus HMI timeouts",idempotencyKey:"quote_request_test1"
      }});
      expect(quote.isError).not.toBe(true);
      const q=quote.structuredContent as {id:string;termsDigest:string};
      const work=await f.client.callTool({name:"work.prepare",arguments:{
        quoteId:q.id,idempotencyKey:"prepare_work_test1",
        inputs:[{name:"observations",kind:"inline",mediaType:"text/plain",data:"Timeouts at 100ms intervals"}],
      }});
      expect(work.isError).not.toBe(true);
      const w=work.structuredContent as {id:string;state:string;funding:{status:string}};
      expect(w.state).toBe("prepared_unfunded");
      const contract=await f.client.readResource({uri:CONTRACT_APP_URI});
      expect(contract.contents[0]&&"text" in contract.contents[0]?contract.contents[0].text:"").toContain("Secure terms");
      expect((work.structuredContent as {reviewUrl:string}).reviewUrl).toBe("https://awc.example/review?work="+encodeURIComponent(w.id));
      expect(w.funding.status).toBe("not_authorized");
      const check=await f.client.callTool({name:"work.get",arguments:{workId:w.id}});
      expect((check.structuredContent as {quoteDigest:string}).quoteDigest).toBe(q.termsDigest);
      const options=await f.client.callTool({name:"billing.options",arguments:{}});
      expect((options.structuredContent as {canStartWithoutFunding:boolean}).canStartWithoutFunding).toBe(false);
      expect(list.tools.some(t=>t.name==="work.start")).toBe(false);
      expect(list.tools.some(t=>t.name==="work.approve")).toBe(false);
    } finally {await f.close();}
  });
});
