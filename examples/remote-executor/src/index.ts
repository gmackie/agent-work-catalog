import { validateExecutionRequest, AdapterError, type ExecutionSnapshot, type ExecutionHandle } from "@awc/adapter-sdk";
import { digest, verifyAwcRequest } from "@awc/adapter-remote-http";
import { analyzeClassicPcap,captureSha256,MAX_CAPTURE_BYTES,PCAP_MEDIA_TYPE } from "@awc/modbus-pcap";
import { analyzeTcpCapture } from "@awc/tcp-analysis";
export interface D1Statement {
  bind(...values:(string|number|null)[]):D1Statement;
  run():Promise<unknown>;
  first<T>():Promise<T|null>;
}
export interface D1Database { prepare(sql:string):D1Statement; }
export interface Env {
  readonly DB:D1Database;
  readonly AWC_SHARED_KEY?:string;
  readonly ENABLE_EXAMPLE_EXECUTOR?:string;
  readonly ENABLE_MODBUS_PCAP?:string;
  readonly ENABLE_TCP_FLOW?:string;
}
type StoredRow={provider_id:string;client_id:string;idempotency_key:string;
  request_digest:string;snapshot_json:string};
const reply=(value:object,status=200)=>Response.json({
  schemaVersion:"awc.executor/v1",...value,
},{status,headers:{"cache-control":"no-store","x-content-type-options":"nosniff"}});
const validKey=(value:string)=>/^[a-zA-Z0-9_.:-]{8,160}$/.test(value);
function parseSegment(value:string|undefined):string{
  if(!value)throw new AdapterError("invalid_input","Missing execution identifier");
  const decoded=decodeURIComponent(value);
  if(!validKey(decoded))throw new AdapterError("invalid_input","Invalid execution identifier");
  return decoded;
}
const responseFor=(row:StoredRow):ExecutionSnapshot=>
  JSON.parse(row.snapshot_json) as ExecutionSnapshot;
const error=(unknown:unknown)=>{
  const err=unknown instanceof AdapterError?unknown:new AdapterError("unavailable","Remote executor failed");
  const status=err.code==="unauthenticated"?401:err.code==="unauthorized"?403:
    err.code==="not_found"?404:err.code==="conflict"?409:err.code==="invalid_input"?400:503;
  return reply({error:err.code},status);
};
/**
 * A realistic signed WorkExecutor HTTP endpoint, with D1-stored acceptance and recovery.
 * Deliberately performs NO LLM inference, sensitive-data handling, or external side effects.
 */
export async function handleRequest(request:Request,env:Env):Promise<Response>{
  const path=new URL(request.url).pathname;
  if(path==="/.well-known/awc-adapter.json" && request.method==="GET") {
    return Response.json({
      schemaVersion:"awc.adapter/v1",
      id:"awc.example.remote-executor",version:"1.0.0",
      displayName:"Read-only example remote Worker",
      roles:["work-executor"],transport:"remote-http",
      supportedTaskTypes:["task:example","task:modbus-diagnostics",
        ...(env.ENABLE_MODBUS_PCAP==="true"?["task:modbus-pcap"]:[]),
        ...(env.ENABLE_TCP_FLOW==="true"?["task:tcp-flow-evidence"]:[])],
      capabilities:["start","inspect","recover","cancel"],
      endpointPaths:{
        start:"/v1/executions",
        recover:"/v1/executions/by-idempotency/{key}",
        inspect:"/v1/executions/{providerExecutionId}",
        cancel:"/v1/executions/{providerExecutionId}/cancel",
      },
      executionPricing:"not for sale; no paid work",
    },{headers:{"cache-control":"public,max-age=300","x-content-type-options":"nosniff"}});
  }
  if(path==="/health" && request.method==="GET")return reply({
    service:"awc-example-remote-executor",mode:"deterministic-public-data-only",
    enabled:env.ENABLE_EXAMPLE_EXECUTOR==="true",
  });
  if(env.ENABLE_EXAMPLE_EXECUTOR!=="true"||!env.AWC_SHARED_KEY||env.AWC_SHARED_KEY.length<32)
    return reply({error:"disabled"},503);
  try{
    const signed=await verifyAwcRequest(request,env.AWC_SHARED_KEY);
    if(request.method==="POST"&&path==="/v1/executions"){
      const input=validateExecutionRequest(JSON.parse(signed.body) as unknown);
      const realModbus=input.taskTypeId==="task:modbus-pcap";
      const realTcp=input.taskTypeId==="task:tcp-flow-evidence";
      const realCapture=realModbus||realTcp;
      if(!(realModbus&&env.ENABLE_MODBUS_PCAP==="true") &&
         !(realTcp&&env.ENABLE_TCP_FLOW==="true") &&
         !["task:example","task:modbus-diagnostics"].includes(input.taskTypeId) ||
         input.constraints.allowedEffects.length ||
         input.constraints.dataClassification!=="public" ||
         !input.requiredOutputs.some(x=>x.mediaType==="application/json")) {
        throw new AdapterError("unsupported","Executor only accepts approved public, read-only JSON tasks");
      }
      if(input.idempotencyKey!==signed.idempotencyKey)
        throw new AdapterError("unauthorized","Idempotency header and work request differ");
      let captureReport:Awaited<ReturnType<typeof analyzeClassicPcap>> |
        Awaited<ReturnType<typeof analyzeTcpCapture>> | undefined;
      if(realCapture){
        if(input.inputs.length!==1 || input.constraints.maxDurationSeconds>300)
          throw new AdapterError("invalid_input","Modbus capture input contract invalid");
        const capture=input.inputs[0]!;
        if(capture.kind!=="inline"||capture.mediaType!==PCAP_MEDIA_TYPE||
          capture.name!=="capture"||typeof capture.data!=="string"||
          !/^[A-Za-z0-9+/]+={0,2}$/.test(capture.data) ||
          capture.data.length>Math.ceil(MAX_CAPTURE_BYTES*4/3)+4 ||
          !/^[a-f0-9]{64}$/.test(capture.sha256??"")) {
          throw new AdapterError("invalid_input","Expected a SHA-bound classic-PCAP base64 input");
        }
        try{
          const raw=Uint8Array.from(atob(capture.data),ch=>ch.charCodeAt(0));
          if(raw.length>MAX_CAPTURE_BYTES || await captureSha256(raw)!==capture.sha256)
            throw new Error("Capture digest mismatch");
          captureReport=realModbus?await analyzeClassicPcap(raw):await analyzeTcpCapture(raw);
        }catch{throw new AdapterError("invalid_input","Capture is malformed, unsupported or altered");}
      }
      const checksum=await digest(signed.body);
      const providerId="job_"+checksum.slice(0,32);
      const handle:ExecutionHandle={
        executionId:input.executionId,providerExecutionId:providerId,status:"completed",
      };
      const snapshot:ExecutionSnapshot={handle,status:"completed",
        updatedAt:new Date().toISOString(),
        result:{
          orderId:input.workOrderId,producedAt:new Date().toISOString(),
          summary:realCapture
            ? realModbus
              ? "Parsed observable Modbus/TCP transactions, not a professional certification"
              : "Parsed observable TCP flows and flags; no packet-loss or causal diagnosis"
            : "Synthetic read-only remote adapter response; no external work was performed",
          artifacts:realCapture
            ? [{name:realModbus?"modbus-findings.json":"tcp-flow-evidence.json",
              kind:"inline",mediaType:"application/json",data:captureReport!}]
            : [{name:"example-result.json",kind:"inline",mediaType:"application/json",data:{
              notice:"Demo result only. Not a verified report, evaluation, or paid professional service.",
              suppliedInputNames:input.inputs.map(x=>x.name),workOrderId:input.workOrderId,
            }}],
        },
      };
      await env.DB.prepare(
        "INSERT OR IGNORE INTO awc_example_executions (provider_id,client_id,idempotency_key,request_digest,snapshot_json,created_at) VALUES (?,?,?,?,?,?)"
      ).bind(providerId,input.executionId,input.idempotencyKey,checksum,JSON.stringify(snapshot),
        new Date().toISOString()).run();
      const stored=await env.DB.prepare(
        "SELECT provider_id,client_id,idempotency_key,request_digest,snapshot_json FROM awc_example_executions WHERE idempotency_key=?"
      ).bind(input.idempotencyKey).first<StoredRow>();
      if(!stored || stored.request_digest!==checksum || stored.client_id!==input.executionId)
        throw new AdapterError("conflict","Idempotency key reused with different work request");
      return reply({handle:responseFor(stored).handle},202);
    }
    const parts=path.split("/").filter(Boolean);
    if(request.method==="GET"&&parts.length===4 &&
       parts[0]==="v1"&&parts[1]==="executions"&&parts[2]==="by-idempotency"){
      const key=parseSegment(parts[3]);
      const row=await env.DB.prepare(
        "SELECT provider_id,client_id,idempotency_key,request_digest,snapshot_json FROM awc_example_executions WHERE idempotency_key=?"
      ).bind(key).first<StoredRow>();
      if(!row)return reply({error:"not_found"},404);
      return reply({handle:responseFor(row).handle});
    }
    if(parts[0]==="v1"&&parts[1]==="executions"&&parts.length>=3){
      const providerId=parseSegment(parts[2]);
      const row=await env.DB.prepare(
        "SELECT provider_id,client_id,idempotency_key,request_digest,snapshot_json FROM awc_example_executions WHERE provider_id=?"
      ).bind(providerId).first<StoredRow>();
      if(!row)return reply({error:"not_found"},404);
      const snapshot=responseFor(row);
      if(request.method==="GET"&&parts.length===3)return reply({snapshot});
      if(request.method==="POST"&&parts.length===4&&parts[3]==="cancel"){
        return reply({status:"already_terminal",handle:snapshot.handle});
      }
    }
    return reply({error:"not_found"},404);
  }catch(err){return error(err);}
}
export default {fetch:handleRequest} satisfies ExportedHandler<Env>;
