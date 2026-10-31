import { Effect, Schema } from "effect";
import {
  AdapterError, type WorkSource, type WorkOpportunity, type ExternalWorkRef,
  type SourceEventEnvelope, type SourceIngestResult, type WorkDelivery,
  type DeliveryAck, type ExternalWorkState, validateDelivery,
} from "@awc/adapter-sdk";
import type { GitHubCredentialProvider } from "./app-auth.ts";
export { createGitHubAppCredentials } from "./app-auth.ts";
export type { GitHubCredentialProvider, GitHubAppAuthConfig } from "./app-auth.ts";

export interface AllowedRepo {
  readonly repositoryId: number;
  readonly fullName: string;
  readonly installationId: number;
}
export interface GitHubSourceConfig {
  readonly id: string;
  readonly secret: string;
  readonly repositories: readonly AllowedRepo[];
  readonly credentials: GitHubCredentialProvider;
  /** Required broker-side authorization and single-writer delivery lease for this exact contract. */
  readonly authorizeDelivery?: (ref:ExternalWorkRef,delivery:WorkDelivery)=>Promise<boolean>;
  readonly label?: string;
  readonly fetcher?: typeof fetch;
  readonly now?: ()=>number;
}
const Event = Schema.Struct({
  action: Schema.String,
  installation: Schema.Struct({id:Schema.Number}),
  repository: Schema.Struct({id:Schema.Number,full_name:Schema.String}),
  issue: Schema.Struct({
    id:Schema.Number,number:Schema.Number,title:Schema.String,
    body:Schema.NullOr(Schema.String),
    state:Schema.String,
    labels:Schema.Array(Schema.Struct({name:Schema.String})),
    pull_request:Schema.optionalKey(Schema.Unknown),
  }),
});
const RepoIssue = Schema.Struct({
  id:Schema.Number,number:Schema.Number,state:Schema.String,
  labels:Schema.Array(Schema.Struct({name:Schema.String})),
});
const Comment = Schema.Struct({id:Schema.Number,body:Schema.NullOr(Schema.String)});
const Comments = Schema.Array(Comment);
const encoder=new TextEncoder();
const sigHex=async(secret:string,bytes:Uint8Array):Promise<string>=>{
  const key=await crypto.subtle.importKey("raw",encoder.encode(secret),
    {name:"HMAC",hash:"SHA-256"},false,["sign"]);
  return [...new Uint8Array(await crypto.subtle.sign("HMAC",key,Uint8Array.from(bytes)))]
    .map(v=>v.toString(16).padStart(2,"0")).join("");
};
const secureSame=(a:string,b:string):boolean=>{
  if(a.length!==b.length)return false;
  let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);
  return diff===0;
};
const headersOf=(headers:Readonly<Record<string,string>>)=>new Map(
  Object.entries(headers).map(([key,value])=>[key.toLowerCase(),value]),
);

/** Signature is over RAW bytes, before UTF-8 decode, JSON parsing or any transformation. */
export async function verifyGitHubWebhook(event:SourceEventEnvelope,secret:string):Promise<{
  deliveryId:string;eventType:string;body:unknown;
}> {
  if(secret.length<16)throw new AdapterError("unavailable","GitHub webhook secret not configured");
  if(event.body.byteLength>256_000)throw new AdapterError("invalid_input","GitHub webhook exceeds size limit");
  const headers=headersOf(event.headers);
  const signature=headers.get("x-hub-signature-256")??"";
  const eventType=headers.get("x-github-event")??"";
  const deliveryId=headers.get("x-github-delivery")??"";
  if(!/^sha256=[a-f0-9]{64}$/.test(signature)||
      !/^[A-Za-z0-9_-]{2,64}$/.test(eventType)||
      !/^[A-Za-z0-9-]{16,100}$/.test(deliveryId))
    throw new AdapterError("unauthenticated","Missing GitHub webhook integrity metadata");
  const expected="sha256="+await sigHex(secret,event.body);
  if(!secureSame(expected,signature))throw new AdapterError("unauthenticated","Invalid GitHub webhook signature");
  try {
    const text=new TextDecoder("utf-8",{fatal:true}).decode(event.body);
    return {deliveryId,eventType,body:JSON.parse(text) as unknown};
  }catch{
    throw new AdapterError("invalid_input","GitHub payload is not valid UTF-8 JSON");
  }
}
const exactRepo=(ref:ExternalWorkRef,allowed:readonly AllowedRepo[]):AllowedRepo=>{
  const record=allowed.find(r=>String(r.repositoryId)===ref.repositoryId &&
    String(r.installationId)===ref.installationId);
  if(!record||!Number.isSafeInteger(ref.issueNumber)||!ref.issueNumber||
      ref.issueNumber<=0 || ref.originUrl!==
      "https://github.com/"+record.fullName+"/issues/"+ref.issueNumber)
    throw new AdapterError("unauthorized","Unrecognized GitHub work reference");
  return record;
};
const pathFor=(repo:AllowedRepo,issueNumber:number)=>
  "/repos/"+repo.fullName+"/issues/"+issueNumber;
const uuidSafe=(value:string)=>/^[a-zA-Z0-9_.:-]{8,160}$/.test(value);
const summaryText=(delivery:WorkDelivery)=>{
  // Only publish a bounded summary and metadata; no private artifact bytes or model traces.
  const msg=delivery.result.summary.slice(0,2000).replace(/\u0000/g,"");
  return "**AWC work result (review required)**\n\n"+msg+
    "\n\nWork order: `"+delivery.workOrderId.replace(/[^a-zA-Z0-9_.:-]/g,"")+
    "`\nArtifacts are retained in the authorized AWC artifact gateway; none are attached to this public comment.";
};
const keyMarker=async(delivery:WorkDelivery):Promise<string>=>{
  const input=encoder.encode(delivery.workOrderId+"\n"+delivery.contractDigest+"\n"+delivery.idempotencyKey);
  const hash=new Uint8Array(await crypto.subtle.digest("SHA-256",input));
  return "<!-- awc-delivery:"+[...hash].map(x=>x.toString(16).padStart(2,"0")).join("")+" -->";
};

export function createGitHubIssueSource(config:GitHubSourceConfig):WorkSource {
  const label=config.label??"agent-work";
  if(!/^[a-z0-9][a-z0-9.-]{2,100}$/.test(config.id)||
    !label||!config.secret||!config.repositories.length)throw new AdapterError("invalid_input","GitHub source is not configured");
  const names=new Set<string>(),ids=new Set<number>();
  for(const repo of config.repositories){
    if(!Number.isSafeInteger(repo.repositoryId)||repo.repositoryId<=0||
       !Number.isSafeInteger(repo.installationId)||repo.installationId<=0||
       !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo.fullName)||
       names.has(repo.fullName.toLowerCase())||ids.has(repo.repositoryId))
      throw new AdapterError("invalid_input","Duplicate or malformed repository allowlist");
    names.add(repo.fullName.toLowerCase());ids.add(repo.repositoryId);
  }
  const fetcher=config.fetcher??fetch,now=config.now??Date.now;
  const allowed=(repoId:number,fullName:string,installationId:number)=>config.repositories.some(
    r=>r.repositoryId===repoId&&r.installationId===installationId&&r.fullName===fullName);
  const api=async(
    ref:ExternalWorkRef,method:"GET"|"POST",path:string,body?:unknown,
  ):Promise<Response>=>{
    const repository=exactRepo(ref,config.repositories);
    const token=await config.credentials.tokenFor(repository.installationId,repository.repositoryId);
    let response:Response;
    try{
      response=await fetcher("https://api.github.com"+path,{
        method,
        headers:{
          accept:"application/vnd.github+json",authorization:"Bearer "+token,
          "x-github-api-version":"2026-03-10",
          ...(body!==undefined?{"content-type":"application/json"}:{}),
        },
        ...(body!==undefined?{body:JSON.stringify(body)}:{}),
        redirect:"error",signal:AbortSignal.timeout(15_000),
      });
    }catch{throw new AdapterError(method==="POST"?"outcome_unknown":"unavailable",
      "GitHub API call may have failed; reconcile before posting again");}
    if(!response.ok){
      const code=response.status===404?"not_found":response.status===403?"unauthorized":
        response.status===429?"rate_limited":method==="POST"&&response.status>=500?"outcome_unknown":"unavailable";
      throw new AdapterError(code,"GitHub API did not complete request");
    }
    return response;
  };
  return {
    manifest:{
      schemaVersion:"awc.adapter/v1",id:config.id,version:"1.0.0",
      displayName:"GitHub Issues source (GitHub App)",
      roles:["work-source","delivery-sink"],transport:"github-app",
      supportedTaskTypes:[],capabilities:["authenticated-webhook","issue-reconciliation","delivery-reconciliation"],
    },
    ingest:event=>Effect.tryPromise({
      try:async():Promise<SourceIngestResult>=>{
        const verified=await verifyGitHubWebhook(event,config.secret);
        if(verified.eventType!=="issues")return {type:"ignored",reason:"unhandled_event",eventId:verified.deliveryId};
        const e=Schema.decodeUnknownSync(Event)(verified.body);
        if(!["labeled","opened"].includes(e.action))return {type:"ignored",reason:"unhandled_action",eventId:verified.deliveryId};
        if(e.issue.pull_request!==undefined)return {type:"ignored",reason:"pull_request_not_issue",eventId:verified.deliveryId};
        if(!allowed(e.repository.id,e.repository.full_name,e.installation.id)){
          throw new AdapterError("unauthorized","GitHub repository or app installation not allowed");
        }
        if(!e.issue.labels.some(l=>l.name===label))return {type:"ignored",reason:"opt_in_label_absent",eventId:verified.deliveryId};
        if(!Number.isSafeInteger(e.issue.number)||e.issue.number<=0||
           !Number.isSafeInteger(e.issue.id)||e.issue.id<=0||
           e.issue.title.length>500||(e.issue.body??"").length>30_000)
          throw new AdapterError("invalid_input","Issue fields out of bounds");
        const ref:ExternalWorkRef={
          sourceId:config.id,
          externalId:"github:"+e.repository.id+":"+e.issue.id,
          originUrl:"https://github.com/"+e.repository.full_name+"/issues/"+e.issue.number,
          repositoryId:String(e.repository.id),installationId:String(e.installation.id),
          issueNumber:e.issue.number,
        };
        const opportunity:WorkOpportunity={
          schemaVersion:"awc.opportunity/v1",
          id:ref.externalId,external:ref,title:e.issue.title,
          description:e.issue.body??"",status:e.issue.state==="open"?"open":"closed",
          observedAt:new Date(now()).toISOString(),eventId:verified.deliveryId,
        };
        return {type:"opportunity",opportunity};
      },catch:e=>e instanceof AdapterError?e:new AdapterError("invalid_input","Invalid GitHub issue event"),
    }),
    inspect:ref=>Effect.tryPromise({
      try:async():Promise<ExternalWorkState>=>{
        const repo=exactRepo(ref,config.repositories);
        const response=await api(ref,"GET",pathFor(repo,ref.issueNumber!));
        const data=Schema.decodeUnknownSync(RepoIssue)(await response.json());
        const open=data.state==="open"&&data.labels.some(l=>l.name===label);
        return {ref,status:open?"open":"closed",observedAt:new Date(now()).toISOString()};
      },catch:e=>e instanceof AdapterError?e:new AdapterError("unavailable","Could not reconcile GitHub issue"),
    }),
    deliver:(ref,payload)=>Effect.tryPromise({
      try:async():Promise<DeliveryAck>=>{
        const repo=exactRepo(ref,config.repositories);
        const delivery=validateDelivery(payload);
        if(!uuidSafe(delivery.idempotencyKey)||!config.authorizeDelivery ||
          !await config.authorizeDelivery(ref,delivery)) {
          throw new AdapterError("unauthorized","Broker delivery authorization and lease required");
        }
        const marker=await keyMarker(delivery);
        const commentsPath=pathFor(repo,ref.issueNumber!)+"/comments";
        // Read all bounded comment pages before posting; if search cannot be completed, refuse an unsafe retry.
        for(let page=1;page<=10;page++){
          const response=await api(ref,"GET",commentsPath+"?per_page=100&page="+page);
          const comments=Schema.decodeUnknownSync(Comments)(await response.json());
          const previous=comments.find(item=>item.body?.includes(marker));
          if(previous){
            return {externalRef:ref,receiptId:"github-comment:"+previous.id,duplicate:true,
              deliveredAt:new Date(now()).toISOString()};
          }
          if(comments.length<100)break;
          if(page===10)throw new AdapterError("outcome_unknown","Comment history exceeds reconciliation limit");
        }
        const text=summaryText(delivery)+"\n\n"+marker;
        const response=await api(ref,"POST",commentsPath,{body:text});
        const posted=Schema.decodeUnknownSync(Comment)(await response.json());
        return {externalRef:ref,receiptId:"github-comment:"+posted.id,duplicate:false,
          deliveredAt:new Date(now()).toISOString()};
      },catch:e=>e instanceof AdapterError?e:new AdapterError("outcome_unknown","GitHub delivery may have been accepted; reconcile by marker"),
    }),
  };
}
