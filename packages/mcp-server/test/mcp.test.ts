import { describe, expect, it } from "vitest";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { makeMarketplace, inMemoryMarketplaceStore } from "@awc/marketplace";
import { createCatalogMcpServer, MARKETPLACE_APP_URI } from "../src/index.ts";

async function fixture(authenticated: boolean) {
  const marketplace = makeMarketplace(inMemoryMarketplaceStore());
  const server = createCatalogMcpServer({marketplace,buyerId:authenticated?"buyer-1":null,appHtml:"<!doctype html><html><body>Sample catalog app</body></html>"});
  const client = new Client({name:"awc-test",version:"0.1.0"});
  const [a,b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(b),client.connect(a)]);
  return {client,server,close:async()=>{await client.close();await server.close();}};
}
describe("AWC MCP server", () => {
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
      expect(w.funding.status).toBe("not_authorized");
      const check=await f.client.callTool({name:"work.get",arguments:{workId:w.id}});
      expect((check.structuredContent as {quoteDigest:string}).quoteDigest).toBe(q.termsDigest);
      const options=await f.client.callTool({name:"billing.options",arguments:{}});
      expect((options.structuredContent as {canStartWork:boolean}).canStartWork).toBe(false);
    } finally {await f.close();}
  });
});
