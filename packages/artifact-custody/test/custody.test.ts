import {describe,expect,it} from "vitest";
import {createR2ArtifactCustody,type R2BucketLike} from "../src/index.ts";
function fakeBucket(){
 const memory=new Map<string,Uint8Array>();
 const bucket:R2BucketLike={
   get:async(key)=>{
     const bytes=memory.get(key);
     return bytes?{size:bytes.length,arrayBuffer:async()=>Uint8Array.from(bytes).buffer}:null;
   },
   put:async(key,content,opts)=>{memory.set(key,Uint8Array.from(content));return {key};},
 };
 return {memory,bucket};
}
describe("R2 private custody",()=>{
 it("is content-addressed and buyer/work scoped",async()=>{
   const {bucket,memory}=fakeBucket();
   const custody=createR2ArtifactCustody(bucket);
   const data=Uint8Array.from([1,2,3,4]);
   const input=await custody.putInput("buyerA",data);
   expect(input.ref).toMatch(/^artifact:sha256:[a-f0-9]{64}$/);
   expect(await custody.readInput("buyerA",input.ref)).toEqual(data);
   await expect(custody.readInput("buyerB",input.ref)).rejects.toThrow();
   const output=await custody.putOutput("buyerA","workA",new TextEncoder().encode('{"status":"ok"}'),"application/json");
   expect(new TextDecoder().decode(await custody.readOutput("buyerA","workA",output.ref))).toBe('{"status":"ok"}');
   await expect(custody.readOutput("buyerA","workB",output.ref)).rejects.toThrow();
   const key=[...memory.keys()].find(k=>k.includes("/result/"))!;
   memory.set(key,new TextEncoder().encode('{"status":"evil"}'));
   await expect(custody.readOutput("buyerA","workA",output.ref)).rejects.toThrow();
 });
 it("rejects invalid types and oversize objects",async()=>{
   const custody=createR2ArtifactCustody(fakeBucket().bucket);
   await expect(custody.putInput("buyerA",new Uint8Array(48*1024+1))).rejects.toThrow();
   await expect(custody.putOutput("buyerA","workA",new Uint8Array([1]),"text/html")).rejects.toThrow();
   await expect(custody.readInput("buyerA","artifact:../../secret")).rejects.toThrow();
 });
});
