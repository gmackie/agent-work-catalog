import { Effect } from "effect";
import {
  AdapterError, validateExecutionRequest, validateExecutionSnapshot,
  type ExecutionRequest, type ExecutionHandle, type WorkExecutor,
} from "@awc/adapter-sdk";
import { validateResult, assertArtifactShape, type WorkResult, type WorkArtifact } from "@awc/contracts";
import type { Commerce, WorkSnapshot } from "@awc/commerce";
import type { PreparedWork, Quote } from "@awc/marketplace";
import { analyzeClassicPcap, captureSha256, MAX_CAPTURE_BYTES, PCAP_MEDIA_TYPE } from "@awc/modbus-pcap";
import { analyzeTcpCapture } from "@awc/tcp-analysis";

/** This contract is administrator-installed, never inferred from a discovered manifest. */
export interface TrustedExecutorBinding {
  readonly id: string;
  readonly origin: string;
  readonly offeringId: string;
  readonly offeringVersion: string;
  readonly taskTypeId: string;
  readonly maxCostMinorUnits: string;
  readonly outputMediaTypes: readonly string[];
  readonly maxDurationSeconds: number;
  /** V1 can only disclose explicitly public, inline, no-side-effect inputs. */
  readonly dataClassification: "public";
  readonly allowedEffects: readonly [];
  readonly executionMode: "synthetic-test-only" | "bounded-modbus-pcap/v1" | "bounded-tcp-flow/v1";
}
export type DispatchStatus =
  "new" | "starting" | "uncertain" | "active" | "polling" |
  "completed" | "finalized" | "manual_review";

export interface DispatchRecord {
  readonly workId: string;
  readonly buyerId: string;
  readonly executorId: string;
  readonly quoteDigest: string;
  readonly requestDigest: string;
  readonly request: ExecutionRequest;
  readonly status: DispatchStatus;
  readonly version: number;
  readonly attempts: number;
  readonly recoveryAttempts: number;
  readonly createdAt: string;
  readonly nextCheckAt: number;
  readonly leaseUntil: number;
  readonly updatedAt: string;
  readonly handle?: ExecutionHandle | undefined;
  readonly result?: WorkResult | undefined;
  readonly resultDigest?: string | undefined;
  readonly lastError?: string | undefined;
}
export interface DispatchStore {
  readonly initialize: (record: DispatchRecord) => Promise<DispatchRecord>;
  readonly get: (buyerId: string, workId: string) => Promise<DispatchRecord | undefined>;
  readonly cas: (before: DispatchRecord, after: DispatchRecord) => Promise<boolean>;
  readonly due: (now: number, limit: number) => Promise<readonly {buyerId:string;workId:string}[]>;
}
export class DispatchError extends Error {
  readonly _tag = "DispatchError";
  constructor(readonly code:
    "invalid_contract" | "unauthorized" | "conflict" | "unavailable" |
    "reconciliation_required" | "not_found" | "not_supported",
    message:string) { super(message); this.name="DispatchError"; }
}
const fail=(e:unknown):DispatchError => e instanceof DispatchError ? e :
  new DispatchError("unavailable","Trusted dispatch could not be completed");
const execute=<T>(fn:()=>Promise<T>):Effect.Effect<T,DispatchError> =>
  Effect.tryPromise({try:fn,catch:fail});
export const sha256 = async (value:string):Promise<string> =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value)))]
    .map(x=>x.toString(16).padStart(2,"0")).join("");
function assertBinding(binding:TrustedExecutorBinding,executor:WorkExecutor):void {
  if(!/^[a-z0-9][a-z0-9.-]{2,100}$/.test(binding.id) ||
      binding.id!==executor.manifest.id ||
      !executor.manifest.roles.includes("work-executor") ||
      !executor.manifest.supportedTaskTypes.includes(binding.taskTypeId) ||
      !/^offering:[a-z0-9-]+$/.test(binding.offeringId) ||
      !/^\d+$/.test(binding.offeringVersion) ||
      !/^(0|[1-9]\d*)$/.test(binding.maxCostMinorUnits) ||
      binding.maxDurationSeconds<1 || binding.maxDurationSeconds>300 ||
      !["synthetic-test-only","bounded-modbus-pcap/v1","bounded-tcp-flow/v1"].includes(binding.executionMode) ||
      (binding.executionMode==="bounded-modbus-pcap/v1" &&
        (binding.offeringId!=="offering:modbus-pcap-analysis" ||
         binding.taskTypeId!=="task:modbus-pcap")) ||
      (binding.executionMode==="bounded-tcp-flow/v1" &&
        (binding.offeringId!=="offering:tcp-flow-evidence" ||
         binding.taskTypeId!=="task:tcp-flow-evidence")) ||
      binding.dataClassification!=="public" ||
      binding.allowedEffects.length!==0 ||
      !binding.outputMediaTypes.includes("application/json")) {
    throw new DispatchError("invalid_contract","Executor must be a verified, explicitly configured public-data sandbox");
  }
  const url=new URL(binding.origin);
  if(url.protocol!=="https:"||url.username||url.password||url.search||url.hash||url.pathname!=="/"||
      url.hostname==="localhost" || /^\d+\.\d+\.\d+\.\d+$/.test(url.hostname) ||
      url.hostname.startsWith("[")) {
    throw new DispatchError("invalid_contract","Trusted executor requires a pinned, public HTTPS origin");
  }
}

/**
 * Exact public data disclosure commitment: quote, inputs, external destination,
 * provider identity, fixed policy and the versioned offering.
 *
 * This digest is independently approved in the human review path, NOT by the MCP agent.
 */
export async function externalDisclosureDigest(
  work:PreparedWork,quote:Quote,binding:TrustedExecutorBinding,
):Promise<string>{
  return sha256(JSON.stringify({
    domain:"awc.remote-disclosure/v1",buyerId:work.buyerId,workId:work.id,
    termsDigest:quote.termsDigest,inputDigest:work.inputDigest,
    classification:work.dataClassification??"internal",
    origin:binding.origin,executorId:binding.id,offeringId:binding.offeringId,
    offeringVersion:binding.offeringVersion,taskTypeId:binding.taskTypeId,
    allowedEffects:[],outputMediaTypes:[...binding.outputMediaTypes],
    executionMode:binding.executionMode,
  }));
}
export interface RemoteInputResolver {
  readonly readInput: (buyerId:string,reference:string)=>Promise<Uint8Array>;
}
export interface RemoteResultProcessor {
  readonly process: (record:DispatchRecord,result:WorkResult)=>Promise<WorkResult>;
}
async function buildRequest(
  work:PreparedWork,quote:Quote,binding:TrustedExecutorBinding,resolver?:RemoteInputResolver,
):Promise<ExecutionRequest> {
  if(work.quoteDigest!==quote.termsDigest||quote.buyerId!==work.buyerId ||
      work.taskTypeId!==binding.taskTypeId||work.offeringId!==binding.offeringId ||
      quote.offeringId!==binding.offeringId||quote.offeringVersion!==binding.offeringVersion ||
      quote.taskTypeId!==binding.taskTypeId ||
      work.dataClassification!=="public" ||
      quote.price.currency!=="USD" ||
      BigInt(quote.price.minorUnits)>BigInt(binding.maxCostMinorUnits) ||
      BigInt(quote.price.minorUnits)<0n ||
      work.inputs.length===0||work.inputs.length>5){
    throw new DispatchError("invalid_contract","Work does not satisfy pinned public-data offering and budget");
  }
  const actualInputDigest=await sha256(JSON.stringify({
    inputs:work.inputs,dataClassification:work.dataClassification,
  }));
  if(actualInputDigest!==work.inputDigest){
    throw new DispatchError("invalid_contract","Prepared input bytes no longer match the human-reviewed commitment");
  }
  let executionInputs:ExecutionRequest["inputs"]=[...work.inputs];
  if(binding.executionMode==="bounded-modbus-pcap/v1" || binding.executionMode==="bounded-tcp-flow/v1"){
    if(work.inputs.length!==1 || !resolver) {
      throw new DispatchError("invalid_contract","Bounded PCAP execution requires one privately stored capture");
    }
    const source=work.inputs[0]!;
    assertArtifactShape(source);
    if(source.kind!=="reference" || source.mediaType!==PCAP_MEDIA_TYPE ||
       !source.sha256 || !/^[a-f0-9]{64}$/.test(source.sha256) ||
       source.reference!=="artifact:sha256:"+source.sha256) {
      throw new DispatchError("invalid_contract","PCAP input must be a digest-bound private artifact reference");
    }
    const bytes=await resolver.readInput(work.buyerId,source.reference);
    if(bytes.length>MAX_CAPTURE_BYTES || await captureSha256(bytes)!==source.sha256){
      throw new DispatchError("invalid_contract","PCAP has changed since human approval");
    }
    // Validate the format before the only allowed disclosure. The original remains
    // in a private R2 bucket; bounded BASE64 crosses the pinned signed HTTP channel.
    if(binding.executionMode==="bounded-modbus-pcap/v1")await analyzeClassicPcap(bytes);
    else await analyzeTcpCapture(bytes);
    const encoded=btoa(String.fromCharCode(...bytes));
    executionInputs=[{name:"capture",kind:"inline",mediaType:PCAP_MEDIA_TYPE,
      data:encoded,sha256:source.sha256}];
  }else {
    for(const input of work.inputs) {
      assertArtifactShape(input);
      if(input.kind!=="inline"||!["text/plain","application/json"].includes(input.mediaType) ||
         typeof input.data!=="string" || input.data.length>4000) {
        throw new DispatchError("invalid_contract","Remote sandbox only accepts small public inline strings");
      }
    }
  }
  const canonical=JSON.stringify({
    workId:work.id,quoteDigest:quote.termsDigest,inputDigest:work.inputDigest,
    executorId:binding.id,offeringId:binding.offeringId,version:binding.offeringVersion,
  });
  const hash=await sha256(canonical);
  const request:ExecutionRequest={
    schemaVersion:"awc.execution/v1",executionId:"exec_"+hash.slice(0,32),
    attemptId:"attempt_1",idempotencyKey:"awc_exec_"+hash,
    workOrderId:work.id,contractDigest:quote.termsDigest,
    taskTypeId:work.taskTypeId,offeringId:work.offeringId,inputs:executionInputs,
    requiredOutputs:binding.outputMediaTypes.map(type=>({role:"result",mediaType:type})),
    constraints:{
      maxCost:quote.price,allowedEffects:[],
      dataClassification:"public",maxDurationSeconds:binding.maxDurationSeconds,
    },
    grantRef:"grant:"+hash,
  };
  return validateExecutionRequest(request);
}
async function validateSubmittedResult(
  result:WorkResult,request:ExecutionRequest,binding:TrustedExecutorBinding,
):Promise<{result:WorkResult;digest:string}>{
  const value=validateResult(result);
  if(value.orderId!==request.workOrderId || value.artifacts.length<1||value.artifacts.length>6 ||
     JSON.stringify(value).length>120_000) {
    throw new DispatchError("invalid_contract","External result is not bound to the work contract");
  }
  const artifacts:WorkArtifact[]=[];
  for(const artifact of value.artifacts) {
    assertArtifactShape(artifact);
    if(artifact.kind!=="inline" || !binding.outputMediaTypes.includes(artifact.mediaType) ||
       artifact.mediaType!=="application/json" || artifact.reference!==undefined) {
      throw new DispatchError("invalid_contract","Remote artifacts must be validated inline JSON");
    }
    const contentDigest=await sha256(JSON.stringify(artifact.data));
    if(artifact.sha256!==undefined && artifact.sha256!==contentDigest){
      throw new DispatchError("invalid_contract","Remote artifact advertised the wrong content digest");
    }
    artifacts.push({...artifact,sha256:contentDigest});
  }
  const submitted:WorkResult={...value,artifacts};
  return {result:submitted,digest:await sha256(JSON.stringify(submitted))};
}
export interface DispatchPlan {
  readonly workId:string;
  readonly quoteDigest:string;
  readonly executorId:string;
  readonly origin:string;
  readonly disclosureDigest:string;
  readonly dataClassification:"public";
  readonly allowedEffects:readonly [];
  readonly mode:"synthetic-test-only" | "bounded-modbus-pcap/v1" | "bounded-tcp-flow/v1";
}
export interface TrustedDispatcher {
  readonly appliesTo: (offeringId:string) => boolean;
  readonly plan: (buyerId:string,workId:string) => Effect.Effect<DispatchPlan,DispatchError>;
  readonly advance: (buyerId:string,workId:string) => Effect.Effect<DispatchRecord,DispatchError>;
  readonly get: (buyerId:string,workId:string) => Effect.Effect<DispatchRecord|null,DispatchError>;
  readonly recoverable: () => Effect.Effect<readonly {buyerId:string;workId:string}[],DispatchError>;
}
export function makeTrustedDispatcher(
  commerce:Commerce,
  store:DispatchStore,
  executor:WorkExecutor,
  binding:TrustedExecutorBinding,
  now:()=>number=Date.now,
  options:{readonly inputResolver?:RemoteInputResolver;
    readonly resultProcessor?:RemoteResultProcessor}={},
):TrustedDispatcher {
  assertBinding(binding,executor);
  const load=async(buyerId:string,workId:string)=>{
    const {work,quote,state}=await Effect.runPromise(commerce.preview(buyerId,workId));
    const request=await buildRequest(work,quote,binding,options.inputResolver);
    const disclosureDigest=await externalDisclosureDigest(work,quote,binding);
    return {work,quote,state,request,disclosureDigest};
  };
  const cas=async(before:DispatchRecord,patch:Partial<DispatchRecord>):Promise<DispatchRecord>=>{
    const after:DispatchRecord={
      ...before,...patch,version:before.version+1,updatedAt:new Date(now()).toISOString(),
    };
    if(!(await store.cas(before,after)))
      throw new DispatchError("conflict","Execution record changed concurrently");
    return after;
  };
  const commit=async(record:DispatchRecord):Promise<DispatchRecord>=>{
    if(!record.result)throw new DispatchError("invalid_contract","Cannot finalize without a validated result");
    await Effect.runPromise(commerce.submitExternalResult(record.buyerId,record.workId,record.result));
    return cas(record,{status:"finalized",leaseUntil:0,nextCheckAt:0});
  };
  const settle=async(record:DispatchRecord):Promise<DispatchRecord>=>{
    if(record.status==="completed")return commit(record);
    return record;
  };
  const poll=async(record:DispatchRecord):Promise<DispatchRecord>=>{
    if(!record.handle) throw new DispatchError("reconciliation_required","Accepted execution has no handle");
    const current=await cas(record,{status:"polling",leaseUntil:now()+40_000,nextCheckAt:now()+40_000});
    try {
      const snapshot=validateExecutionSnapshot(
        await Effect.runPromise(executor.inspect(current.handle!)),current.request,
      );
      if(snapshot.handle.providerExecutionId!==record.handle?.providerExecutionId)
        throw new DispatchError("invalid_contract","Provider switched execution handle");
      if(snapshot.status==="completed"){
        if(!snapshot.result)throw new DispatchError("invalid_contract","Completed execution omitted result");
        const verified=await validateSubmittedResult(snapshot.result,current.request,binding);
        let result=verified.result;
        if(binding.executionMode==="bounded-modbus-pcap/v1" || binding.executionMode==="bounded-tcp-flow/v1"){
          if(!options.resultProcessor)throw new DispatchError("invalid_contract","Report evaluator and R2 custody required");
          try { result=await options.resultProcessor.process(current,result); }
          catch {throw new DispatchError("invalid_contract","Report evaluation, custody or signed evidence failed");}
        }
        const storedDigest=await sha256(JSON.stringify(result));
        const saved=await cas(current,{
          status:"completed",leaseUntil:0,nextCheckAt:0,result,resultDigest:storedDigest,
        });
        return commit(saved);
      }
      if(snapshot.status==="failed"||snapshot.status==="cancelled"||snapshot.status==="input_required"){
        return cas(current,{status:"manual_review",leaseUntil:0,nextCheckAt:0,
          lastError:"Remote execution requires manual intervention: "+snapshot.status});
      }
      return cas(current,{status:"active",leaseUntil:0,nextCheckAt:now()+30_000});
    }catch(error){
      if(error instanceof DispatchError && error.code==="invalid_contract"){
        return cas(current,{status:"manual_review",leaseUntil:0,nextCheckAt:0,lastError:error.message});
      }
      return cas(current,{status:"active",leaseUntil:0,nextCheckAt:now()+60_000,
        lastError:"Remote inspection unavailable; preserving accepted execution"});
    }
  };
  const inspectAfterAccepted=async(record:DispatchRecord,handle:ExecutionHandle)=>{
    if(handle.executionId!==record.request.executionId)
      return cas(record,{status:"manual_review",leaseUntil:0,nextCheckAt:0,
        lastError:"Provider returned an unexpected execution identifier"});
    const accepted=await cas(record,{
      status:"active",handle,leaseUntil:0,nextCheckAt:now(),
    });
    return poll(accepted);
  };
  const advance=async(buyerId:string,workId:string):Promise<DispatchRecord>=>{
    const {work,state,request,disclosureDigest}=await load(buyerId,workId);
    if(!["queued","external_running","submitted"].includes(state.status) ||
       !state.approvedBy || !["sandbox","stripe-test"].includes(state.paymentRail??"") ||
       state.externalConsentDigest!==disclosureDigest) {
      throw new DispatchError("unauthorized","Approved, test-funded contract and exact external disclosure consent required");
    }
    const requestDigest=await sha256(JSON.stringify(request));
    let record=await store.initialize({
      workId:work.id,buyerId,executorId:binding.id,quoteDigest:work.quoteDigest,
      requestDigest,request,status:"new",version:0,attempts:0,recoveryAttempts:0,
      createdAt:new Date(now()).toISOString(),nextCheckAt:0,
      leaseUntil:0,updatedAt:new Date(now()).toISOString(),
    });
    if(record.quoteDigest!==work.quoteDigest||record.requestDigest!==requestDigest ||
       record.executorId!==binding.id||record.buyerId!==buyerId)
      throw new DispatchError("conflict","Immutable remote execution commitment changed");
    if(record.status==="finalized")return record;
    if(state.status==="queued"){
      await Effect.runPromise(commerce.markExternalRunning(buyerId,workId,disclosureDigest));
    }
    if(record.leaseUntil>now()||record.nextCheckAt>now())return record;
    if(record.status==="completed")return commit(record);
    if(record.status==="manual_review")return record;
    if(record.status!=="new" && now()-Date.parse(record.createdAt)>15*60_000 +
        binding.maxDurationSeconds*1000) {
      return cas(record,{status:"manual_review",leaseUntil:0,nextCheckAt:0,
        lastError:"Execution reconciliation exceeded sandbox deadline; manual operator review required"});
    }
    const priorStatus=record.status;
    record=await cas(record,{
      status:priorStatus==="new"?"starting":
        priorStatus==="active"?"polling":priorStatus,
      leaseUntil:now()+40_000,nextCheckAt:now()+40_000,
      ...(priorStatus==="new"?{attempts:record.attempts+1}:{}),
    });
    if(priorStatus==="new"){
      try{
        const handle=await Effect.runPromise(executor.start(request));
        return inspectAfterAccepted(record,handle);
      }catch(error){
        const message=error instanceof AdapterError?error.code:"outcome_unknown";
        // Even a 5xx may mean the remote worker accepted the operation.
        return cas(record,{
          status:"uncertain",leaseUntil:0,nextCheckAt:now()+45_000,
          lastError:"Start outcome uncertain; only recover-by-idempotency is permitted ("+message+")",
        });
      }
    }
    if(priorStatus==="starting"||priorStatus==="uncertain"){
      const recoveryAttempts=record.recoveryAttempts+1;
      try{
        const found=await Effect.runPromise(executor.recover(request));
        if(found)return inspectAfterAccepted(record,found);
        const review=recoveryAttempts>=12;
        return cas(record,{
          status:review?"manual_review":"uncertain",
          leaseUntil:0,nextCheckAt:review?0:now()+60_000,recoveryAttempts,
          lastError:review?"Recovery threshold exceeded; operator must resolve the original execution":
            "Provider has not yet confirmed acceptance; no second start attempt",
        });
      }catch{
        const review=recoveryAttempts>=12;
        return cas(record,{
          status:review?"manual_review":"uncertain",
          leaseUntil:0,nextCheckAt:review?0:now()+60_000,recoveryAttempts,
          lastError:review?"Remote recovery repeatedly unavailable; manual resolution required":
            "Recovery temporarily unavailable; original idempotency key preserved",
        });
      }
    }
    if(!record.handle)return cas(record,{status:"manual_review",leaseUntil:0,nextCheckAt:0,
      lastError:"Previously accepted execution lost its handle"});
    // The previous CAS claimed this lease; poll() will take another CAS before invoking the provider.
    return poll(record);
  };
  return {
    appliesTo:offeringId=>offeringId===binding.offeringId,
    plan:(buyerId,workId)=>execute(async()=>{
      const {work,quote,disclosureDigest}=await load(buyerId,workId);
      return {workId,quoteDigest:quote.termsDigest,executorId:binding.id,
        origin:binding.origin,disclosureDigest,dataClassification:"public",
        allowedEffects:[] as const,mode:binding.executionMode};
    }),
    advance:(buyerId,workId)=>execute(()=>advance(buyerId,workId)),
    get:(buyerId,workId)=>execute(async()=>{
      const record=await store.get(buyerId,workId);
      return record??null;
    }),
    recoverable:()=>execute(()=>store.due(now(),100)),
  };
}

/** Test helper. Production uses D1 optimistic CAS and never in-memory state. */
export function inMemoryDispatchStore():DispatchStore {
  const rows=new Map<string,DispatchRecord>();
  return {
    initialize:async(initial)=>{
      const existing=rows.get(initial.workId);
      if(existing)return existing;
      rows.set(initial.workId,initial);
      return initial;
    },
    get:async(buyerId,id)=>{
      const row=rows.get(id);
      return row?.buyerId===buyerId?row:undefined;
    },
    cas:async(before,after)=>{
      const current=rows.get(before.workId);
      if(!current||current.version!==before.version||current.status!==before.status)return false;
      rows.set(before.workId,after);return true;
    },
    due:async(time,limit)=>[...rows.values()].filter(x=>
      !["finalized","manual_review"].includes(x.status) &&
      x.nextCheckAt<=time&&x.leaseUntil<=time)
      .slice(0,limit).map(x=>({buyerId:x.buyerId,workId:x.workId})),
  };
}
