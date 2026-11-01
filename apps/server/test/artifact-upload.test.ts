import { describe,expect,it } from "vitest";
import {handleRequest,type Env} from "../src/index.ts";
import {makeTestPcap} from "@awc/modbus-pcap/testing";

const ctx={waitUntil:()=>{}} as unknown as ExecutionContext;
const token="public-data-only-buyer-token-for-tests-123456";
function bucket(){
  const data=new Map<string,Uint8Array>();
  return {
    data,
    get:async(key:string)=>{
      const b=data.get(key);
      return b?{size:b.length,arrayBuffer:async()=>Uint8Array.from(b).buffer}:null;
    },
    put:async(key:string,contents:ArrayBuffer)=>{
      data.set(key,new Uint8Array(contents));return {key};
    },
  };
}
describe("Authenticated private PCAP upload API",()=>{
  const bytes=makeTestPcap([
    {direction:"request",transactionId:7,functionCode:3},
    {direction:"response",transactionId:7,functionCode:3},
  ]);
  it("requires buyer authentication and declared-public media type, then writes immutable R2 bytes",async()=>{
    const b=bucket();
    const env={ENABLE_MODBUS_PCAP:"true",ENABLE_LOCAL_SANDBOX:"true",
      AWC_BUYER_TOKEN:token,ARTIFACTS:b} as unknown as Env;
    const request=(authenticated:boolean,declared:boolean)=>new Request("http://localhost:8787/api/artifacts/input",{
      method:"POST",headers:{
        ...(authenticated?{authorization:"Bearer "+token}:{}),
        "content-type":"application/vnd.tcpdump.pcap",
        ...(declared?{"x-awc-data-classification":"public"}:{}),
      },body:bytes,
    });
    expect((await handleRequest(request(false,true),env,ctx)).status).toBe(401);
    expect((await handleRequest(request(true,false),env,ctx)).status).toBe(415);
    const res=await handleRequest(request(true,true),env,ctx);
    expect(res.status).toBe(201);
    const record=await res.json() as {ref:string;sha256:string;bytes:number};
    expect(record.bytes).toBe(bytes.length);
    expect(record.ref).toBe("artifact:sha256:"+record.sha256);
    expect(b.data.size).toBe(1);
    expect([...b.data.values()][0]).toEqual(bytes);
  });
  it("will not accept pcapng or a nonclassic capture",async()=>{
    const pcapng=Uint8Array.from(bytes);
    pcapng.set([0x0a,0x0d,0x0d,0x0a],0);
    const r=await handleRequest(new Request("http://localhost:8787/api/artifacts/input",{
      method:"POST",headers:{authorization:"Bearer "+token,"content-type":"application/vnd.tcpdump.pcap",
        "x-awc-data-classification":"public"},body:pcapng,
    }),{ENABLE_MODBUS_PCAP:"true",ENABLE_LOCAL_SANDBOX:"true",
      AWC_BUYER_TOKEN:token,ARTIFACTS:bucket()} as unknown as Env,ctx);
    expect(r.status).not.toBe(201);
  });
});
