import type {AuthzenDecision,AuthzenEvaluationRequest} from "@awc/authzen";

/**
 * Bounded subset of the OpenID AuthZEN Access Request and Approval Draft 1.
 * PDP and Access Request Service share the same verified denial state. The PEP
 * may REQUEST review; it cannot APPROVE or manufacture an approval credential.
 */
export interface AuthzenApprovalClientConfig {
 readonly pdpOrigin:string;
 readonly bearerToken:()=>Promise<string>;
 readonly fetcher?:typeof fetch;
 readonly timeoutMs?:number;
}
export interface RequestableDenial {
 readonly decision:false;
 readonly context:{
   readonly evaluation_id:string;
   readonly evaluated_at?:string;
   readonly reason?:string;
   readonly access_request:{
     readonly endpoint?:string;
     readonly expires_at:string;
     readonly template?:string;
   };
 };
}
export interface AccessRequestTask {
 readonly task:{
   readonly id:string;readonly status:"pending"|"approved"|"denied"|"expired"|"cancelled"|"failed";
   readonly status_endpoint:string;readonly expires_at?:string;
 };
 readonly result?:{readonly mode:"reevaluate";readonly approval:{
   readonly id:string;readonly approved_at?:string;readonly approved_until:string;
 }};
}
export class ApprovalClientError extends Error{
 constructor(readonly code:"invalid_hint"|"unavailable"|"invalid_task"|"not_approved",message:string){
  super(message);this.name="ApprovalClientError";
 }
}
const bounded=(x:unknown):x is string=>typeof x==="string"&&x.length>0&&x.length<=256;
const validId=(s:unknown):s is string=>typeof s==="string"&&/^arq_[0-9a-f]{32}$/.test(s);
export function createAccessRequestClient(config:AuthzenApprovalClientConfig){
 let origin:URL;
 try{origin=new URL(config.pdpOrigin);}catch{throw new ApprovalClientError("invalid_hint","Invalid PDP origin");}
 if(origin.protocol!=="https:"||origin.pathname!=="/"||origin.search||origin.hash||
    origin.username||origin.password)throw new ApprovalClientError("invalid_hint","PDP must be pinned HTTPS origin");
 const base=origin.origin,fetcher=config.fetcher??fetch;
 const timeout=config.timeoutMs??3000;
 if(!Number.isSafeInteger(timeout)||timeout<200||timeout>15000)
  throw new ApprovalClientError("invalid_hint","Invalid request timeout");
 const send=async(url:string,method:"POST"|"GET",body?:object,key?:string):Promise<unknown>=>{
  let token:string;
  try{token=await config.bearerToken();}catch{throw new ApprovalClientError("unavailable","PDP credential unavailable");}
  if(token.length<12||!/^[A-Za-z0-9._~+\/-]+$/.test(token)){
   throw new ApprovalClientError("unavailable","PDP access token missing");
  }
  let response:Response;
  try{response=await fetcher(url,{
   method,redirect:"error",
   headers:{authorization:"Bearer "+token,accept:"application/json",
    ...(method==="POST"?{"content-type":"application/json"}:{}),
    ...(key?{"idempotency-key":key}:{})},
   ...(body?{body:JSON.stringify(body)}:{}),
   signal:AbortSignal.timeout(timeout),
  });}catch{throw new ApprovalClientError("unavailable","PDP request service unavailable");}
  if(!response.ok||!response.headers.get("content-type")?.includes("application/json")){
   throw new ApprovalClientError("unavailable","Approval service denied request");
  }
  try{return await response.json();}catch{throw new ApprovalClientError("invalid_task","Non-JSON task");}
 };
 const task=(raw:unknown):AccessRequestTask=>{
  if(!raw||typeof raw!=="object"||Array.isArray(raw))
   throw new ApprovalClientError("invalid_task","Malformed approval response");
  const value=raw as Record<string,unknown>;
  const t=value.task as Record<string,unknown>|undefined;
  if(!t||!validId(t.id)||!["pending","approved","denied","expired","cancelled","failed"].includes(String(t.status))||
    t.status_endpoint!==base+"/access/v1/requests/"+t.id){
    throw new ApprovalClientError("invalid_task","Task handle untrusted or outside PDP origin");
  }
  if(t.status==="approved"){
   const r=value.result as Record<string,unknown>|undefined;
   const a=r?.approval as Record<string,unknown>|undefined;
   if(r?.mode!=="reevaluate"||!a||!bounded(a.id)||
     !bounded(a.approved_until)||!Number.isFinite(Date.parse(a.approved_until as string))){
    throw new ApprovalClientError("invalid_task","Approved task has no verified binding reference");
   }
  }
  return raw as AccessRequestTask;
 };
 return {
  request:async(original:AuthzenEvaluationRequest,denied:AuthzenDecision,idempotencyKey:string):Promise<AccessRequestTask>=>{
   const hint=(denied as RequestableDenial).context;
   const info=hint?.access_request;
   if(denied.decision!==false||!hint||!bounded(hint.evaluation_id)||!info||
      info.endpoint!==undefined && info.endpoint!==base+"/access/v1/requests"||
      !Number.isFinite(Date.parse(info.expires_at))||Date.parse(info.expires_at)<=Date.now()||
      !/^[A-Za-z0-9_-]{12,128}$/.test(idempotencyKey)){
    throw new ApprovalClientError("invalid_hint","PDP did not issue an unexpired requestable denial");
   }
   const body={
    subject:original.subject,action:original.action,resource:original.resource,
    ...(original.context?{context:original.context}:{}),
    denial:{
      evaluation_id:hint.evaluation_id,
      expires_at:info.expires_at,
      ...(hint.evaluated_at?{evaluated_at:hint.evaluated_at}:{}),
      ...(hint.reason?{reason:hint.reason}:{})
    }
   };
   return task(await send(base+"/access/v1/requests","POST",body,idempotencyKey));
  },
  status:async(id:string):Promise<AccessRequestTask>=>{
   if(!validId(id))throw new ApprovalClientError("invalid_task","Unknown task identifier");
   return task(await send(base+"/access/v1/requests/"+id,"GET"));
  },
  reevaluate:(
   original:AuthzenEvaluationRequest,
   approval:AccessRequestTask,
  ):AuthzenEvaluationRequest=>{
   const t=task(approval);
   if(t.task.status!=="approved"||!t.result?.approval||
      Date.parse(t.result.approval.approved_until)<=Date.now()){
    throw new ApprovalClientError("not_approved","Only a current approved task may be reevaluated");
   }
   return {...original,context:{
    ...original.context,
    approval:t.result.approval
   }};
  },
 };
}
