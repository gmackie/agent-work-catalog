import { describe,expect,it } from "vitest";
import { handleRequest,type Env } from "../src/index.ts";

const secret="github-real-webhook-secret-for-integration-test";
function fakeDb(){
  const events=new Map<string,string>();
  const works=new Map<string,{buyer_id:string;source_id:string;payload:string;first_seen_at:string}>();
  return {
    prepare(sql:string){
      let args:(string|number|null)[]=[];
      const stmt={
        bind(...values:(string|number|null)[]){args=values;return stmt;},
        async first<T>():Promise<T|null>{
          if(sql.includes("awc_inbound_events")){
            const value=events.get(String(args[0])+":"+String(args[1]));
            return value?{digest:value} as T:null;
          }
          const found=sql.includes("id=?") ? works.get(String(args[1])) : undefined;
          return found as T ?? null;
        },
        async all<T>():Promise<{results:T[]}>{
          return {results:[...works.values()].filter(x=>x.buyer_id===args[0]) as T[]};
        },
        async run(){
          if(sql.includes("INTO awc_inbound_events")){
            const key=String(args[0])+":"+String(args[1]);
            if(!events.has(key))events.set(key,String(args[2]));
          }
          if(sql.includes("INTO awc_opportunities")){
            if(!works.has(String(args[0])))works.set(String(args[0]),{
              buyer_id:String(args[1]),source_id:String(args[2]),
              payload:String(args[3]),first_seen_at:String(args[4]),
            });
          }
        },
      };
      return stmt;
    },
    async batch(statements:Array<{run():Promise<unknown>}>){
      for(const statement of statements)await statement.run();
      return [];
    },
    works,events,
  };
}
async function signedRequest(repoId=123,installationId=987){
  const payload={
    action:"labeled",installation:{id:installationId},repository:{id:repoId,full_name:"testorg/fixture"},
    issue:{id:456,number:7,title:"Build a read-only report",
      body:"We need a report on this test repository.",state:"open",labels:[{name:"agent-work"}]},
  };
  const bytes=new TextEncoder().encode(JSON.stringify(payload));
  const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(secret),
    {name:"HMAC",hash:"SHA-256"},false,["sign"]);
  const signature="sha256="+[...new Uint8Array(await crypto.subtle.sign("HMAC",key,Uint8Array.from(bytes)))]
    .map(x=>x.toString(16).padStart(2,"0")).join("");
  return new Request("https://awc.example/integrations/github/webhook",{
    method:"POST",headers:{
      "content-type":"application/json",
      "x-github-event":"issues",
      "x-github-delivery":"aabbccdd-1122-3344-5566-778899aabbcc",
      "x-hub-signature-256":signature,
    },body:bytes,
  });
}
const ctx={waitUntil:()=>{}} as unknown as ExecutionContext;
describe("real inbound GitHub App webhook integration",()=>{
  it("accepts signed issues to a replay-protected D1 opportunity inbox, never to a WorkOrder",async()=>{
    const db=fakeDb();
    const env={
      DB:db,ENABLE_GITHUB_SOURCE:"true",GITHUB_WEBHOOK_SECRET:secret,
      GITHUB_SOURCE_REPOSITORIES:JSON.stringify([{repositoryId:123,fullName:"testorg/fixture",installationId:987}]),
      GITHUB_SOURCE_BUYER_ID:"buyer-tenant",
    } as unknown as Env;
    const first=await handleRequest(await signedRequest(),env,ctx);
    expect(first.status).toBe(202);
    const a=await first.json() as {kind:string;duplicate:boolean;commercialStatus:string};
    expect(a.kind).toBe("opportunity");
    expect(a.duplicate).toBe(false);
    expect(a.commercialStatus).toBe("not_authorized");
    expect(db.works.size).toBe(1);
    expect(db.events.size).toBe(1);
    const replay=await handleRequest(await signedRequest(),env,ctx);
    expect((await replay.json() as {duplicate:boolean}).duplicate).toBe(true);
    expect(db.works.size).toBe(1);
    const row=[...db.works.values()][0]!;
    expect(row.buyer_id).toBe("buyer-tenant");
    expect(JSON.parse(row.payload).id).toBe("github:123:456");
  });
  it("denies unsigned payloads, unapproved installations, and disabled source endpoints",async()=>{
    const good={
      DB:fakeDb(),ENABLE_GITHUB_SOURCE:"true",GITHUB_WEBHOOK_SECRET:secret,
      GITHUB_SOURCE_REPOSITORIES:JSON.stringify([{repositoryId:123,fullName:"testorg/fixture",installationId:987}]),
      GITHUB_SOURCE_BUYER_ID:"buyer-tenant",
    } as unknown as Env;
    const invalid=await signedRequest();
    invalid.headers.set("x-hub-signature-256","sha256="+"a".repeat(64));
    expect((await handleRequest(invalid,good,ctx)).status).toBe(401);
    expect((await handleRequest(await signedRequest(123,999),good,ctx)).status).toBe(403);
    expect((await handleRequest(await signedRequest(),{...good,ENABLE_GITHUB_SOURCE:"false"} as Env,ctx)).status).toBe(404);
  });
});
