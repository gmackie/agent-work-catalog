import { Context, Effect, Layer, Schema } from "effect";
import type { ManagedEntity, OperationalObservation, ActionReceipt } from "@awc/operations";
import type { ActionProposal } from "@awc/responsibility";

export const AdapterManifest = Schema.Struct({
 schemaVersion:Schema.Literal("awc.managed-adapter/v1"),
 id:Schema.String,
 version:Schema.String,
 name:Schema.String,
 role:Schema.Literal("managed-system"),
 transport:Schema.Literals(["bundled-reviewed","remote-read-only","simulation"]),
 entityKinds:Schema.Array(Schema.String),
 capabilities:Schema.Array(Schema.Struct({
  id:Schema.String,
  effect:Schema.Literals(["read","plan","commercial","operational","physical-control","safety-critical"]),
  inputSchemaRef:Schema.optionalKey(Schema.String),
  requiresIndependentApproval:Schema.Boolean,
 })),
});
export type AdapterManifest = typeof AdapterManifest.Type;
export const decodeManifest = Schema.decodeUnknownSync(AdapterManifest);
export class AdapterError extends Error{
 readonly _tag="AdapterError";
 constructor(readonly code:"invalid_manifest"|"unauthorized"|"unavailable"|"unsupported",
  message:string){super(message);this.name="AdapterError";}
}
export interface ManagedSystemAdapter {
 readonly manifest:AdapterManifest;
 readonly describe:()=>Effect.Effect<readonly ManagedEntity[],AdapterError>;
 readonly observe:(entityId:string)=>Effect.Effect<OperationalObservation,AdapterError>;
 /**
  * Only internally authorized deployments MAY implement a mutation port. Presence is
  * not proof of authorization: the host must verify a signed, exact-revision grant,
  * current site policy and equipment safety independently of this interface.
  */
 readonly submitApprovedAction?:(
  request:{proposal:ActionProposal;trustedGrantRef:string}
 )=>Effect.Effect<ActionReceipt,AdapterError>;
}
export class ManagedSystemAdapters extends Context.Service<
 ManagedSystemAdapters,{
  readonly get:(adapterId:string)=>Effect.Effect<ManagedSystemAdapter,AdapterError>;
 }
>()("@awc/ManagedSystemAdapters") {}
/** The manifest is untrusted provider data; capability publication != authorization. */
export function validateAdapterManifest(m:AdapterManifest):void{
 if(!m.id||!m.version||!m.name||m.entityKinds.length===0){
  throw new AdapterError("invalid_manifest","Missing adapter identity or entity kinds");
 }
 const actions=new Set<string>();
 for(const cap of m.capabilities){
  if(!cap.id||actions.has(cap.id))throw new AdapterError("invalid_manifest","Duplicate or missing capability");
  actions.add(cap.id);
  if(m.transport==="remote-read-only"&&cap.effect!=="read"&&cap.effect!=="plan"){
   throw new AdapterError("invalid_manifest","Remote read-only adapter cannot advertise mutations");
  }
  if((cap.effect==="physical-control"||cap.effect==="safety-critical")&&!cap.requiresIndependentApproval){
   throw new AdapterError("invalid_manifest","Physical control requires an explicit site-level approval contract");
  }
 }
}
export function adapterRegistryLayer(adapters:readonly ManagedSystemAdapter[]){
 const registered=new Map<string,ManagedSystemAdapter>();
 for(const a of adapters){
  validateAdapterManifest(a.manifest);
  if(registered.has(a.manifest.id))throw new AdapterError("invalid_manifest","Duplicate adapter identity");
  if(a.submitApprovedAction && a.manifest.transport==="remote-read-only"){
   throw new AdapterError("invalid_manifest","Read-only adapters cannot implement a mutation port");
  }
  registered.set(a.manifest.id,a);
 }
 return Layer.succeed(ManagedSystemAdapters,{
  get:(id:string)=>registered.has(id)
   ? Effect.succeed(registered.get(id)!)
   : Effect.fail(new AdapterError("unavailable","Adapter not registered")),
 });
}
export interface MinimalThingDescription {
 readonly id:string;readonly title?:string;
 readonly properties?:Readonly<Record<string,unknown>>;
 readonly actions?:Readonly<Record<string,unknown>>;
 readonly events?:Readonly<Record<string,unknown>>;
}
/**
 * Converts W3C Thing Description names into *untrusted discovery claims only*.
 * WoT actions NEVER become authorized control operations automatically.
 */
export function inspectThingDescription(td:MinimalThingDescription){
 if(!td.id || td.id.length>500)throw new AdapterError("invalid_manifest","Thing identity invalid");
 const properties=Object.keys(td.properties??{});
 const actions=Object.keys(td.actions??{});
 const events=Object.keys(td.events??{});
 return {thingId:td.id,properties,actions:actions.map(id=>({
  id,authority:"not-granted" as const,risk:"unknown-needs-review" as const,
 })),events};
}
