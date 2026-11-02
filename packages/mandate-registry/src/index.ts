import { assertActionRevision, assertMandateValid, mandateChain } from "@awc/responsibility";
import type { ActionProposal, OperatingMandate, PolicyContext, PolicyDecision } from "@awc/responsibility";
import { createAuthzenPdp, type AuthoritativeProposal, type AuthzenResolver, type VerifiedPdpCaller } from "@awc/authzen";

/**
 * The caller's tenant is derived from the verified access token and NEVER from
 * the AuthZEN input context, mandate JSON, tool invocation or resource URL.
 */
export interface TrustedRegistryCaller extends VerifiedPdpCaller {
  readonly tenantId: string;
}
export interface TrustedProposalSnapshot {
  readonly tenantId: string;
  readonly proposal: ActionProposal;
  readonly policy: PolicyContext;
}
export interface TrustedMandateRegistry {
  resolve(tenantId:string, proposalId:string, subjectId:string):Promise<AuthoritativeProposal|undefined>;
}
export class RegistryError extends Error {
  readonly _tag = "RegistryError";
  constructor(readonly code:"invalid_record"|"not_found"|"unavailable",message:string){
    super(message);this.name="RegistryError";
  }
}
export async function assertTrustedSnapshot(snapshot:TrustedProposalSnapshot):Promise<void>{
  if(!snapshot.tenantId||snapshot.tenantId.length>200) {
    throw new RegistryError("invalid_record","Tenant identity missing");
  }
  const {proposal,policy}=snapshot;
  if(!proposal.id||proposal.actorId.length>200||!proposal.mandateId||
    !policy.assetOwnerId || !Number.isFinite(Date.parse(policy.now))) {
    throw new RegistryError("invalid_record","Incomplete trusted policy snapshot");
  }
  try{
    await assertActionRevision(proposal);
    const chain=mandateChain(proposal.mandateId,policy.mandates);
    // Root issuer must be the original principal. The issuer must have been
    // authenticated independently by the registry writer at registration time.
    const root=chain[chain.length-1]!;
    assertMandateValid(root);
    if(root.issuerId!==root.principalId)throw new Error("Root issuer does not match principal");
    if(chain[0]!.delegateId!==proposal.actorId ||
       chain[0]!.operationId!==proposal.operationId){
      throw new Error("Wrong acting delegate or operation");
    }
    if(!policy.ownerPermissions.every(x=>x.ownerId===policy.assetOwnerId && x.entityId===proposal.entityId)){
      throw new Error("Foreign asset owner permissions");
    }
    if(!policy.actionPolicies.every(x=>x.entityId===proposal.entityId)){
      throw new Error("Foreign action policies");
    }
  }catch{
    throw new RegistryError("invalid_record","Registry records conflict or are not valid");
  }
}
/**
 * In-memory read-only registry for conformance tests. No API for agents to issue
 * their own grants; snapshots are supplied by the trusted test harness.
 */
export function createStaticTrustedRegistry(snapshots:readonly TrustedProposalSnapshot[]):TrustedMandateRegistry{
  const byKey=new Map<string,TrustedProposalSnapshot>();
  for(const snap of snapshots){
    const key=snap.tenantId+"|"+snap.proposal.id;
    if(byKey.has(key))throw new RegistryError("invalid_record","Duplicate trusted proposal");
    byKey.set(key,snap);
  }
  return {
    resolve:async(tenantId,proposalId,subjectId)=>{
      const snap=byKey.get(tenantId+"|"+proposalId);
      if(!snap||snap.proposal.actorId!==subjectId)return undefined;
      await assertTrustedSnapshot(snap);
      return {proposal:snap.proposal,policy:snap.policy};
    },
  };
}
export function createRegistryBackedPdp(registry:TrustedMandateRegistry){
  return {
    evaluate:async(request:unknown,caller:TrustedRegistryCaller)=>{
      const resolver:AuthzenResolver={
        resolve:(proposalId: string,token:VerifiedPdpCaller)=>
          registry.resolve(caller.tenantId,proposalId,token.subjectId),
      };
      return createAuthzenPdp(resolver).evaluate(request,caller);
    },
  };
}
