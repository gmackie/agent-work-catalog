/**
 * Open Service Broker API 2.17 adapter (read-only catalog + provision preview).
 * NEVER sends provisioning or deletion requests. Broker identity and payment
 * authorization must be established before a real provisioner is added.
 */
export interface ServicePlan {
  readonly id:string;readonly name:string;readonly description:string;
  readonly free?:boolean;
}
export interface ServiceOffering {
  readonly id:string;readonly name:string;readonly description:string;
  readonly bindable:boolean;readonly plans:readonly ServicePlan[];
}
export interface Catalog {
  readonly services:readonly ServiceOffering[];
}
export class OsbError extends Error{
  constructor(readonly code:"invalid_catalog"|"no_quote"|"unauthorized",message:string){
    super(message);this.name="OsbError";
  }
}
const obj=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==="object"&&!Array.isArray(v);
const val=(v:unknown):v is string=>typeof v==="string"&&v.length>0&&v.length<=256;
export function parseOsbCatalog(raw:unknown):Catalog {
  if(!obj(raw)||!Array.isArray(raw.services)||raw.services.length>500) {
    throw new OsbError("invalid_catalog","Missing bounded OSB service catalog");
  }
  const seen=new Set<string>();
  const services:ServiceOffering[]=raw.services.map(s=>{
    if(!obj(s)||!val(s.id)||!val(s.name)||!val(s.description)||typeof s.bindable!=="boolean"||
       !Array.isArray(s.plans)||s.plans.length>500||seen.has(s.id)) {
      throw new OsbError("invalid_catalog","Service definition invalid");
    }
    seen.add(s.id);
    const planIds=new Set<string>();
    const plans:ServicePlan[]=s.plans.map(p=>{
      if(!obj(p)||!val(p.id)||!val(p.name)||!val(p.description)||
         (p.free!==undefined&&typeof p.free!=="boolean")||planIds.has(p.id)) {
        throw new OsbError("invalid_catalog","Service plan invalid");
      }
      planIds.add(p.id);
      return {id:p.id,name:p.name,description:p.description,...(typeof p.free==="boolean"?{free:p.free}:{})};
    });
    return {id:s.id,name:s.name,description:s.description,bindable:s.bindable,plans};
  });
  return {services};
}
export interface ResourcePlan {
  readonly providerId:string;readonly serviceId:string;readonly planId:string;
  readonly description:string;readonly requiresQuote:true;
}
/** OSB does not guarantee pricing or lease expiry fields; never invent them. */
export function osbResourcePlans(catalog:Catalog,providerId:string):readonly ResourcePlan[]{
  return catalog.services.flatMap(s=>s.plans.map(p=>({
    providerId,serviceId:s.id,planId:p.id,description:s.description+" — "+p.description,
    requiresQuote:true as const,
  })));
}
export interface TrustedProvisionGrant {
  readonly providerId:string;readonly serviceId:string;readonly planId:string;
  readonly instanceId:string;readonly contractDigest:string;
  readonly accountId:string;readonly maxSpendMinor:string;readonly currency:string;
  readonly expiresAt:string;
}
export interface ProvisionPreview {
  readonly protocol:"osb/2.17";
  readonly method:"PUT";
  readonly url:string;
  readonly headers:Readonly<Record<string,string>>;
  readonly body:{readonly service_id:string;readonly plan_id:string};
  readonly authorizedForExecution:false;
}
/** Generates an approval-bound protocol request; does not execute it. */
export function previewOsbProvision(input:{
  readonly trustedBrokerOrigin:string;
  readonly registeredProviderId:string;
  readonly catalog:Catalog;
  readonly grant:TrustedProvisionGrant;
  readonly now:string;
}):ProvisionPreview {
  const {grant,catalog,registeredProviderId,trustedBrokerOrigin}=input;
  const base=new URL(trustedBrokerOrigin);
  if(base.protocol!=="https:"||base.username||base.password||base.search||base.hash||
     base.pathname!=="/"||!registeredProviderId||!grant.contractDigest||
     !/^[0-9a-zA-Z_-]{6,128}$/.test(grant.instanceId)||
     !/^(0|[1-9][0-9]*)$/.test(grant.maxSpendMinor)||
     !Number.isFinite(Date.parse(grant.expiresAt))||
     Date.parse(grant.expiresAt)<=Date.parse(input.now)||
     grant.providerId!==registeredProviderId) {
    throw new OsbError("unauthorized","Provisioning request is not approval-bound or broker URL is untrusted");
  }
  const service=catalog.services.find(s=>s.id===grant.serviceId);
  if(!service?.plans.some(p=>p.id===grant.planId))throw new OsbError("no_quote","Unknown service plan");
  const url=new URL("/v2/service_instances/"+encodeURIComponent(grant.instanceId),base);
  url.searchParams.set("accepts_incomplete","true");
  return {
    protocol:"osb/2.17",method:"PUT",url:url.toString(),
    headers:{"X-Broker-API-Version":"2.17","Content-Type":"application/json"},
    body:{service_id:grant.serviceId,plan_id:grant.planId},
    authorizedForExecution:false,
  };
}
