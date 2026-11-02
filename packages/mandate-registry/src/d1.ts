import { decodeMandate, decodeProposal, type OperatingMandate, type PolicyContext } from "@awc/responsibility";
import { RegistryError, assertTrustedSnapshot, type TrustedMandateRegistry } from "./index.ts";

/** Read-side only. A separately authenticated issuer service controls writes. */
export interface D1Statement {
  bind(...params:(string|number|null)[]):D1Statement;
  first<T>():Promise<T|null>;
  all<T>():Promise<{results:T[]}>;
}
export interface D1Database {
  prepare(sql:string):D1Statement;
}
type ProposalRow={
  proposal_id:string;tenant_id:string;actor_id:string;operation_id:string;entity_id:string;payload:string;
};
type MandateRow={id:string;tenant_id:string;payload:string;revoked_at:string|null};
type EntityRow={owner_id:string;observation_version:string|null;observed_at:string|null;
  observation_source_id:string|null};
type ActionPolicyRow={action:string;risk:string;effects_json:string};
type OwnerRow={owner_id:string;principal_id:string;entity_id:string;actions_json:string;valid_until:string};
type ApprovalRow={approver_id:string;proposal_id:string;revision:string;valid_until:string};
const decode=<T>(json:string, label:string):T=>{
  if(json.length>50_000)throw new RegistryError("invalid_record",label+" oversized");
  try{return JSON.parse(json) as T;}catch{
    throw new RegistryError("invalid_record",label+" is not JSON");
  }
};
const safe=(str:string)=>str.length>0 && str.length<=256;
/**
 * Queries are always tenant-scoped. Snapshot is read as a preflight ONLY:
 * external effects must re-evaluate current revocation and asset state at commit.
 */
export function d1TrustedMandateRegistry(
  db:D1Database,
  now:()=>number=Date.now,
):TrustedMandateRegistry {
  return {
    resolve:async(tenantId:string,proposalId:string,subjectId:string)=>{
      if(!safe(tenantId)||!safe(proposalId)||!safe(subjectId))return undefined;
      const p=await db.prepare(
        "SELECT tenant_id,proposal_id,actor_id,operation_id,entity_id,payload "+
        "FROM awc_trusted_proposals WHERE tenant_id=? AND proposal_id=? AND actor_id=?"
      ).bind(tenantId,proposalId,subjectId).first<ProposalRow>();
      if(!p)return undefined;
      const proposal=decodeProposal(decode<unknown>(p.payload,"Proposal"));
      if(p.tenant_id!==tenantId || p.proposal_id!==proposal.id ||
         p.actor_id!==proposal.actorId || p.operation_id!==proposal.operationId||
         p.entity_id!==proposal.entityId) {
        throw new RegistryError("invalid_record","Proposal registration disagrees with payload");
      }
      const chain:OperatingMandate[]=[];
      const seen=new Set<string>();
      let current:string|undefined=proposal.mandateId;
      const revoked:string[]=[];
      while(current){
        if(chain.length>=32||seen.has(current))throw new RegistryError("invalid_record","Cyclic or deep mandate");
        seen.add(current);
        const m=await db.prepare(
          "SELECT id,tenant_id,payload,revoked_at FROM awc_trusted_mandates WHERE tenant_id=? AND id=?"
        ).bind(tenantId,current).first<MandateRow>();
        if(!m)throw new RegistryError("invalid_record","Mandate chain incomplete");
        const mandate=decodeMandate(decode<unknown>(m.payload,"Mandate"));
        if(m.tenant_id!==tenantId || m.id!==mandate.id || mandate.operationId!==proposal.operationId){
          throw new RegistryError("invalid_record","Mandate stored under wrong key or operation");
        }
        chain.push(mandate);
        if(m.revoked_at)revoked.push(mandate.id);
        current=mandate.parentId;
      }
      const entity=await db.prepare(
        "SELECT owner_id,observation_version,observed_at,observation_source_id "+
        "FROM awc_trusted_entities WHERE tenant_id=? AND entity_id=? AND operation_id=?"
      ).bind(tenantId,proposal.entityId,proposal.operationId).first<EntityRow>();
      if(!entity||!safe(entity.owner_id))throw new RegistryError("invalid_record","Managed asset missing");
      const [actionResult,ownerResult,approvalResult]=await Promise.all([
        db.prepare("SELECT action,risk,effects_json FROM awc_trusted_action_policies "+
          "WHERE tenant_id=? AND entity_id=? AND active=1 LIMIT 128"
        ).bind(tenantId,proposal.entityId).all<ActionPolicyRow>(),
        db.prepare("SELECT owner_id,principal_id,entity_id,actions_json,valid_until "+
          "FROM awc_trusted_owner_grants WHERE tenant_id=? AND entity_id=? AND revoked_at IS NULL LIMIT 128"
        ).bind(tenantId,proposal.entityId).all<OwnerRow>(),
        db.prepare("SELECT approver_id,proposal_id,revision,valid_until "+
          "FROM awc_trusted_approvals WHERE tenant_id=? AND proposal_id=? AND revoked_at IS NULL LIMIT 128"
        ).bind(tenantId,proposalId).all<ApprovalRow>()
      ]);
      if(actionResult.results.length>127||ownerResult.results.length>127||
         approvalResult.results.length>127){
        throw new RegistryError("invalid_record","Trust record limit exceeded");
      }
      const allowedRisks=["observe","plan","commercial","operational","physical-control","safety-critical"];
      const actionPolicies=actionResult.results.map(x=>{
        const effects=decode<unknown>(x.effects_json,"Action policy effects");
        if(!allowedRisks.includes(x.risk)||!Array.isArray(effects)||
          !effects.every(y=>typeof y==="string"&&safe(y)))throw new RegistryError("invalid_record","Invalid action descriptor");
        return {entityId:proposal.entityId,action:x.action,
          risk:x.risk as PolicyContext["actionPolicies"][number]["risk"],allowedEffects:effects as string[]};
      });
      const ownerPermissions=ownerResult.results.map(x=>{
        const actions=decode<unknown>(x.actions_json,"Owner grant actions");
        if(x.entity_id!==proposal.entityId || x.owner_id!==entity.owner_id||
          !Array.isArray(actions)||!actions.every(y=>typeof y==="string"&&safe(y))||
          !safe(x.principal_id))throw new RegistryError("invalid_record","Foreign owner grant");
        return {ownerId:x.owner_id,granteePrincipalId:x.principal_id,entityId:x.entity_id,
          actions:actions as string[],validUntil:x.valid_until};
      });
      const approvals=approvalResult.results.map(x=>({
        approverId:x.approver_id,proposalId:x.proposal_id,
        revision:x.revision,validUntil:x.valid_until,
      }));
      const observation=entity.observation_version&&entity.observed_at&&entity.observation_source_id
        ? {entityId:proposal.entityId,stateVersion:entity.observation_version,
           observedAt:entity.observed_at,sourceId:entity.observation_source_id}
        : undefined;
      const snapshot={
        tenantId,proposal,
        policy:{
          now:new Date(now()).toISOString(),mandates:chain,revokedMandateIds:revoked,
          assetOwnerId:entity.owner_id,ownerPermissions,actionPolicies,approvals,
          ...(observation?{observation}:{})
        },
      };
      await assertTrustedSnapshot(snapshot);
      return {proposal,policy:snapshot.policy};
    },
  };
}
