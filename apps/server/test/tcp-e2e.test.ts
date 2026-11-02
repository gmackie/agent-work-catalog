import { describe,expect,it } from "vitest";
import { Effect } from "effect";
import { generateKeyPair,exportPKCS8,exportSPKI } from "jose";
import { makeMarketplace,inMemoryMarketplaceStore } from "@awc/marketplace";
import { makeCommerce,sandboxExecutor,type WorkSnapshot,type WorkStateStore } from "@awc/commerce";
import { createR2ArtifactCustody,type R2BucketLike } from "@awc/artifact-custody";
import { makeTestPcap } from "@awc/modbus-pcap/testing";
import { PCAP_MEDIA_TYPE } from "@awc/modbus-pcap";
import { createTcpResultProcessor } from "@awc/tcp-workflow";
import { verifyObservation, TCP_OBSERVATION_SCHEMA } from "@awc/attest-receipts";
import { makeTrustedDispatcher,inMemoryDispatchStore,externalDisclosureDigest,
  type TrustedExecutorBinding } from "@awc/dispatch";
import { createRemoteHttpExecutor } from "@awc/adapter-remote-http";
import { handleRequest as remoteHandler,type D1Database as RemoteD1 } from "../../../examples/remote-executor/src/index.ts";

const key="awc-pcap-remote-long-shared-key-for-tests-123456";
const signed=<T>(eff:Effect.Effect<T,any>):Promise<T>=>Effect.runPromise(eff);
function makeR2(){
 const data=new Map<string,Uint8Array>();
 const bucket:R2BucketLike={
   put:async(path,bytes)=>{data.set(path,Uint8Array.from(bytes));return {key:path};},
   get:async(path)=>{const bytes=data.get(path);return bytes?{
     size:bytes.length,arrayBuffer:async()=>Uint8Array.from(bytes).buffer,
   }:null;},
 };
 return {data,custody:createR2ArtifactCustody(bucket)};
}
function workState():WorkStateStore{
 const states=new Map<string,WorkSnapshot>();
 return {
   initialize:async(work,time)=>{
     let state=states.get(work.id);
     if(!state){state={id:work.id,buyerId:work.buyerId,quoteDigest:work.quoteDigest,
       status:"prepared_unfunded",version:0,attempts:0,updatedAt:time};
       states.set(work.id,state);}
     return state;
   },
   get:async(buyer,id)=>{const x=states.get(id);return x?.buyerId===buyer?x:undefined;},
   cas:async(before,after)=>{
     const current=states.get(before.id);
     if(!current||current.version!==before.version||current.status!==before.status)return false;
     states.set(before.id,after);return true;
   },
   recoverable:async()=>[],
 };
}
function workerD1():RemoteD1 {
 type Row={provider_id:string;client_id:string;idempotency_key:string;request_digest:string;snapshot_json:string};
 const data=new Map<string,Row>();
 return {
   prepare:(sql:string)=>{
     let args:(string|number|null)[]=[];
     const statement={
       bind(...items:(string|number|null)[]){args=items;return statement;},
       async run(){
         if(sql.startsWith("INSERT")){
           const [provider_id,client_id,idempotency_key,request_digest,snapshot_json]=args as
             [string,string,string,string,string];
           if(!data.has(idempotency_key))data.set(idempotency_key,{
             provider_id,client_id,idempotency_key,request_digest,snapshot_json});
         }
       },
       async first<T>():Promise<T|null>{
         const row=sql.includes("WHERE idempotency_key=")?data.get(String(args[0])):
           [...data.values()].find(x=>x.provider_id===args[0]);
         return row as T??null;
       },
     };
     return statement;
   },
 };
}
describe("Actual TCP evidence -> R2 -> signed remote Worker -> checked report -> Attest observation",()=>{
 it("commits a real bounded analysis with scoped artifacts and independently verifiable broker signature",async()=>{
   const {custody,data}=makeR2();
   const capture=makeTestPcap([
     {direction:"request",transactionId:61,functionCode:3,timestampMicros:10000},
     {direction:"response",transactionId:61,functionCode:3,exceptionCode:2,timestampMicros:56000},
     {direction:"request",transactionId:62,functionCode:4,timestampMicros:65000},
   ]);
   const input=await custody.putInput("buyerA",capture);
   const clock=()=>Date.parse("2026-11-01T19:00:00Z");
   const marketplace=makeMarketplace(inMemoryMarketplaceStore(),clock);
   const quote=await signed(marketplace.requestQuote("buyerA",{
     offeringId:"offering:tcp-flow-evidence",
     scope:"Evaluate PUBLIC, synthetic classic PCAP for traceable TCP flow evidence",
     idempotencyKey:"tcp_flow_quote_test_01",
   }));
   const work=await signed(marketplace.prepareWork("buyerA",{
     quoteId:quote.id,idempotencyKey:"tcp_flow_work_test_01",dataClassification:"public",
     inputs:[{name:"pcap",mediaType:PCAP_MEDIA_TYPE,kind:"reference",
       reference:input.ref,sha256:input.sha256}],
   }));
   const binding:TrustedExecutorBinding={
     id:"remote.pcap",origin:"https://pcap.example/",
     offeringId:"offering:tcp-flow-evidence",offeringVersion:"1",
     taskTypeId:"task:tcp-flow-evidence",maxCostMinorUnits:"2500",
     outputMediaTypes:["application/json"],maxDurationSeconds:120,
     dataClassification:"public",allowedEffects:[],executionMode:"bounded-tcp-flow/v1",
   };
   const commerce=makeCommerce(marketplace,workState(),sandboxExecutor,{
     now:clock,enableSandboxFunding:true,externalDisclosureDigest:(w,q)=>
       w.offeringId===binding.offeringId?externalDisclosureDigest(w,q,binding):Promise.resolve(undefined),
   });
   const keys=await generateKeyPair("EdDSA",{extractable:true});
   const signer={issuerId:"issuer:awc-pilot",keyId:"example-1",
     privateKeyPem:await exportPKCS8(keys.privateKey),
     publicKeyPem:await exportSPKI(keys.publicKey)};
   const remoteEnv={
     DB:workerD1(),AWC_SHARED_KEY:key,ENABLE_EXAMPLE_EXECUTOR:"true",ENABLE_TCP_FLOW:"true",
   };
   let posts=0;
   const remote=createRemoteHttpExecutor({
     id:binding.id,baseUrl:binding.origin,allowedHost:"pcap.example",sharedKey:key,
     supportedTaskTypes:["task:tcp-flow-evidence"],
     fetcher:(async(url:RequestInfo|URL,init?:RequestInit)=>{
       const request=new Request(url,init);
       if(request.method==="POST" && new URL(request.url).pathname==="/v1/executions")posts++;
       return remoteHandler(request,remoteEnv);
     }) as typeof fetch,
   });
   const dispatch=makeTrustedDispatcher(commerce,inMemoryDispatchStore(),remote,binding,clock,{
     inputResolver:custody,resultProcessor:createTcpResultProcessor(custody,signer),
   });
   const plan=await signed(dispatch.plan("buyerA",work.id));
   expect(plan.mode).toBe("bounded-tcp-flow/v1");
   await signed(commerce.approve("buyerA",work.id,{
     buyerId:"buyerA",approverSubject:"human",ceremony:"local-sandbox-only",
     reviewedDigest:quote.termsDigest,
   }));
   await signed(commerce.consentExternal("buyerA",work.id,{
     buyerId:"buyerA",approverSubject:"human",ceremony:"local-sandbox-only",
     reviewedDigest:plan.disclosureDigest,
   }));
   await signed(commerce.sandboxFund("buyerA",work.id));
   await signed(commerce.start("buyerA",work.id));
   const finished=await signed(dispatch.advance("buyerA",work.id));
   expect(finished.status).toBe("finalized");
   expect(finished.result?.artifacts).toHaveLength(3);
   expect(posts).toBe(1);
   const artifacts=finished.result!.artifacts;
   const first=await custody.readOutput("buyerA",work.id,artifacts[0]!.reference!);
   const report=JSON.parse(new TextDecoder().decode(first)) as {
     coverage:{parsedTcpSegments:number;flowCount:number},
     flows:Array<{observedSegments:number;observedPayloadBytes:number}>,
     findings:Array<{kind:string}>};
   expect(report.coverage.parsedTcpSegments).toBe(3);
   expect(report.coverage.flowCount).toBe(1);
   expect(report.flows[0]?.observedSegments).toBe(3);
   expect(report.findings.map(x=>x.kind)).toContain("midstream_capture");
   const verification=await custody.readOutput("buyerA",work.id,artifacts[1]!.reference!);
   expect((JSON.parse(new TextDecoder().decode(verification)) as {status:string}).status).toBe("passed");
   const receipt=await custody.readOutput("buyerA",work.id,artifacts[2]!.reference!);
   const statement=await verifyObservation(new TextDecoder().decode(receipt),{
     issuerId:signer.issuerId,keyId:signer.keyId,publicKeyPem:signer.publicKeyPem,
     workId:work.id,contractDigest:quote.termsDigest,
     schema:TCP_OBSERVATION_SCHEMA,
   });
   expect(statement.assurance).toBe("direct-observation");
   expect(statement.claims["awc.flow_count"]?.value).toBe("1");
   expect(data.size).toBe(4);
   await expect(custody.readOutput("buyerB",work.id,artifacts[0]!.reference!)).rejects.toThrow();
   expect((await signed(dispatch.advance("buyerA",work.id))).status).toBe("finalized");
   expect(posts).toBe(1);
 });
});
