import { describe,expect,it } from "vitest";
import { Effect } from "effect";
import {
  createGitHubIssueSource,verifyGitHubWebhook,type AllowedRepo,
} from "../src/index.ts";
import type { WorkDelivery, SourceEventEnvelope } from "@awc/adapter-sdk";

const secret="github-webhook-secret-change-in-deployment";
const allow:AllowedRepo={repositoryId:123,fullName:"testorg/fixture",installationId:987};
const headerSig=async(body:Uint8Array)=>{
  const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(secret),
    {name:"HMAC",hash:"SHA-256"},false,["sign"]);
  return "sha256="+[...new Uint8Array(await crypto.subtle.sign("HMAC",key,body))]
    .map(x=>x.toString(16).padStart(2,"0")).join("");
};
function fixture(overrides:Record<string,unknown>={}){
  return {
    action:"labeled",installation:{id:987},repository:{id:123,full_name:"testorg/fixture"},
    issue:{id:456,number:7,title:"Review auth boundary",
      body:"Prepare a read-only finding report",
      state:"open",labels:[{name:"agent-work"}]},
    ...overrides,
  };
}
async function envelope(value:unknown,eventType="issues"):Promise<SourceEventEnvelope>{
  const body=new TextEncoder().encode(JSON.stringify(value));
  return {body,headers:{
    "x-github-event":eventType,
    "x-github-delivery":"aabbccdd-1122-3344-5566-778899aabbcc",
    "x-hub-signature-256":await headerSig(body),
  }};
}
const source=(params:Partial<Parameters<typeof createGitHubIssueSource>[0]>={})=>
  createGitHubIssueSource({
    id:"github.source",secret,repositories:[allow],
    credentials:{tokenFor:async()=>"fake-installation-token"},
    ...params,
  });
describe("GitHub App work source",()=>{
  it("authenticates exact bytes and creates ONLY an opportunity, never a funded order",async()=>{
    const event=await envelope(fixture());
    const result=await Effect.runPromise(source().ingest(event));
    expect(result.type).toBe("opportunity");
    if(result.type==="opportunity"){
      expect(result.opportunity.id).toBe("github:123:456");
      expect(result.opportunity.external.originUrl).toBe("https://github.com/testorg/fixture/issues/7");
      expect("funding" in result.opportunity).toBe(false);
    }
    event.body[0] = event.body[0]===123?91:123;
    await expect(verifyGitHubWebhook(event,secret)).rejects.toThrow();
  });
  it("rejects unexpected installation/repo and ignores pull request lookalikes",async()=>{
    await expect(Effect.runPromise(source().ingest(await envelope(fixture({
      installation:{id:1},
    }))))).rejects.toThrow();
    const pr=await Effect.runPromise(source().ingest(await envelope(fixture({
      issue:{...fixture().issue,pull_request:{url:"https://api.github.com/pulls/7"}},
    }))));
    expect(pr.type).toBe("ignored");
    const unlabeled=await Effect.runPromise(source().ingest(await envelope(fixture({
      issue:{...fixture().issue,labels:[]},
    }))));
    expect(unlabeled.type).toBe("ignored");
  });
  it("reconciles issue status with an installation token and publishes a single marked comment",async()=>{
    let writes=0;const comments:Array<{id:number;body:string}>=[];
    const fetcher=async(input:RequestInfo|URL,init?:RequestInit)=>{
      const request=new Request(input,init);
      expect(request.headers.get("authorization")).toBe("Bearer fake-installation-token");
      const u=new URL(request.url);
      if(request.method==="GET"&&u.pathname.endsWith("/comments"))return Response.json(comments);
      if(request.method==="GET")return Response.json({id:456,number:7,state:"open",labels:[{name:"agent-work"}]});
      writes++;
      const data=await request.json() as {body:string};
      comments.push({id:999,body:data.body});
      return Response.json(comments[0],{status:201});
    };
    const adapter=source({fetcher:fetcher as typeof fetch,authorizeDelivery:async()=>true});
    const ingested=await Effect.runPromise(adapter.ingest(await envelope(fixture())));
    if(ingested.type!=="opportunity")throw Error("Expected issue");
    const status=await Effect.runPromise(adapter.inspect(ingested.opportunity.external));
    expect(status.status).toBe("open");
    const delivery:WorkDelivery={workOrderId:"work_1",contractDigest:"a".repeat(64),
      idempotencyKey:"delivery_key_123456",result:{orderId:"work_1",
        summary:"Reviewed the input. Further assessment needed.",artifacts:[],producedAt:"2026-10-31T19:00:00Z"}};
    const first=await Effect.runPromise(adapter.deliver(ingested.opportunity.external,delivery));
    const again=await Effect.runPromise(adapter.deliver(ingested.opportunity.external,delivery));
    expect(first.duplicate).toBe(false);
    expect(again.duplicate).toBe(true);
    expect(writes).toBe(1);
    expect(comments[0]?.body).not.toContain("fake-installation-token");
  });
  it("will not deliver without broker policy approval",async()=>{
    const adapter=source();
    const ingested=await Effect.runPromise(adapter.ingest(await envelope(fixture())));
    if(ingested.type!=="opportunity")throw Error("Expected");
    const delivery:WorkDelivery={workOrderId:"work_1",contractDigest:"a".repeat(64),
      idempotencyKey:"delivery_key_123456",result:{orderId:"work_1",
      summary:"ok",artifacts:[],producedAt:"2026-10-31T19:00:00Z"}};
    await expect(Effect.runPromise(adapter.deliver(ingested.opportunity.external,delivery))).rejects.toThrow();
  });
});
