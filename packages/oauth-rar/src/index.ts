import { assertActionRevision } from "@awc/responsibility";
import type { ActionProposal } from "@awc/responsibility";

/**
 * RFC 9396 authorization_details: AWC transaction-specific 'type' extension.
 * This is a request/grant comparison profile, NOT a signed OAuth token, issuer,
 * wallet grant, completed payment, or permission to bypass Gatekeeper.
 */
export const AWC_RAR_TYPE = "https://github.com/gmackie/agent-work-catalog#authorization-details-action-v1";
export interface AWCActionAuthorizationDetail {
  readonly type:typeof AWC_RAR_TYPE;
  readonly actions:readonly [string];
  readonly locations:readonly [string];
  readonly identifier:string;
  readonly awc_mandate_id:string;
  readonly awc_operation_id:string;
  readonly awc_actor_id:string;
  readonly awc_proposal_revision:string;
  readonly awc_entity_id:string;
  readonly awc_maximum_minor?:string;
  readonly awc_currency?:string;
  readonly awc_account_id?:string;
  readonly awc_pricing_ref?:string;
}
export class RarError extends Error{
  constructor(readonly code:"invalid_detail"|"invalid_action"|"mismatch",
    message:string){super(message);this.name="RarError";}
}
function baseUrl(value:string):string{
  let u:URL;
  try{u=new URL(value);}catch{throw new RarError("invalid_detail","Invalid protected-resource URL");}
  if(u.protocol!=="https:"||u.username||u.password||u.hash||u.search||
     u.pathname!=="/")throw new RarError("invalid_detail","Resource URL must be a registered HTTPS origin");
  return u.origin;
}
function money(x:string):boolean{
  return /^(0|[1-9][0-9]*)$/.test(x)&&BigInt(x)<=10n**18n;
}
/** Caller MUST use a policy-verifiable proposal from trusted work order registry. */
export async function createActionAuthorizationDetail(
  proposal:ActionProposal,resourceOrigin:string,
):Promise<AWCActionAuthorizationDetail>{
  await assertActionRevision(proposal);
  const resource=baseUrl(resourceOrigin);
  const c=proposal.commitment;
  if(!proposal.id||!proposal.mandateId||!proposal.actorId||
    (c&&(!money(c.maximumMinor)||c.maximumMinor==="0"||!/^[A-Z]{3}$/.test(c.currency)||!c.accountId||!c.pricingReference))){
    throw new RarError("invalid_action","Malformed commercial action");
  }
  return {
    type:AWC_RAR_TYPE,actions:[proposal.action],locations:[resource],
    identifier:proposal.id,
    awc_mandate_id:proposal.mandateId,awc_operation_id:proposal.operationId,
    awc_actor_id:proposal.actorId,awc_proposal_revision:proposal.revision,
    awc_entity_id:proposal.entityId,
    ...(c?{awc_maximum_minor:c.maximumMinor,awc_currency:c.currency,
      awc_account_id:c.accountId,awc_pricing_ref:c.pricingReference}:{})
  };
}
const canonical=(x:unknown):string=>{
  if(Array.isArray(x))return "["+x.map(canonical).join(",")+"]";
  if(x&&typeof x==="object"){
    return "{"+Object.entries(x).sort(([a],[b])=>a.localeCompare(b))
      .map(([k,v])=>JSON.stringify(k)+":"+canonical(v)).join(",")+"}";
  }
  return JSON.stringify(x);
};
/**
 * Validate the exact effective grant returned by a trusted issuer/introspection
 * response against one approved proposal. No action/resource/amount widening.
 * Assumes cryptographic token validity and issuer/audience verification performed
 * by an independent OAuth component BEFORE this function is invoked.
 */
export function assertExactRarGrant(
 expected:AWCActionAuthorizationDetail,raw:unknown,
):void{
 if(!raw||typeof raw!=="object"||Array.isArray(raw)){
  throw new RarError("invalid_detail","Authorization details missing");
 }
 const provided=raw as Record<string,unknown>;
 const baseline=expected as unknown as Record<string,unknown>;
 if(Object.keys(provided).length!==Object.keys(baseline).length||
    Object.keys(provided).some(k=>!Object.prototype.hasOwnProperty.call(baseline,k))||
    canonical(raw)!==canonical(expected)){
  throw new RarError("mismatch","OAuth grant does not match exact approved action");
 }
}
export function encodeRarAuthorizationDetails(detail:AWCActionAuthorizationDetail):string{
 return JSON.stringify([detail]);
}
