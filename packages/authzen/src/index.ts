import { assertActionRevision, evaluateAction } from "@awc/responsibility";
import type { ActionProposal, PolicyContext, PolicyDecision } from "@awc/responsibility";

/** OpenID AuthZEN Authorization API 1.0 evaluation information model. */
export interface AuthzenEntity {
  readonly type: string;
  readonly id: string;
  readonly properties?: Readonly<Record<string, unknown>>;
}
export interface AuthzenAction {
  readonly name: string;
  readonly properties?: Readonly<Record<string, unknown>>;
}
export interface AuthzenEvaluationRequest {
  readonly subject: AuthzenEntity;
  readonly action: AuthzenAction;
  readonly resource: AuthzenEntity;
  readonly context?: Readonly<Record<string, unknown>>;
}
export interface AuthzenDecision {
  readonly decision: boolean;
  readonly context?: Readonly<Record<string, unknown>>;
}
export interface VerifiedPdpCaller {
  readonly subjectId: string;
  /** The PDP receives this identity from a verified access token / mTLS, not JSON arguments. */
  readonly clientId: string;
}
/** The resolver is backed by an authoritative mandate and proposal registry, not the request body. */
export interface AuthoritativeProposal {
  readonly proposal: ActionProposal;
  readonly policy: PolicyContext;
}
export interface TrustedConditionalAuthorization {
  readonly proposalId:string;
  readonly revision:string;
  readonly actorId:string;
  readonly entityId:string;
  readonly action:string;
  readonly expiresAt:string;
}
/** Implemented only by a trusted, durable economic/operations authorization gateway,
 * not by a model input, unsigned grant, or external provider claim. */
export interface ConditionalAuthorizationVerifier {
  verify(
    trusted:AuthoritativeProposal,
    caller:VerifiedPdpCaller
  ):Promise<TrustedConditionalAuthorization|undefined>;
}
export interface AuthzenResolver {
  resolve(
    proposalId: string,
    caller: VerifiedPdpCaller,
  ): Promise<AuthoritativeProposal | undefined>;
}
export class AuthzenError extends Error {
  readonly _tag = "AuthzenError";
  constructor(readonly code: "invalid_request" | "not_configured", message: string) {
    super(message);
    this.name = "AuthzenError";
  }
}
const record=(x:unknown):x is Record<string,unknown> =>
  !!x && typeof x==="object" && !Array.isArray(x);
const bounded=(x:unknown): x is string =>
  typeof x==="string" && x.length>0 && x.length<=512;
function readEntity(x:unknown):AuthzenEntity {
  if(!record(x)||!bounded(x.type)||!bounded(x.id)||
     (x.properties!==undefined&&!record(x.properties))) {
    throw new AuthzenError("invalid_request","Malformed AuthZEN subject/resource");
  }
  return {type:x.type,id:x.id,...(x.properties===undefined?{}:{properties:x.properties as Record<string,unknown>})};
}
/** Strict parser for the AWC-specific AuthZEN input profile. */
export function parseAuthzenEvaluation(raw:unknown):AuthzenEvaluationRequest {
  if(!record(raw)||!record(raw.action)||!bounded(raw.action.name)||
    (raw.action.properties!==undefined&&!record(raw.action.properties))||
    (raw.context!==undefined&&!record(raw.context))) {
    throw new AuthzenError("invalid_request","Malformed AuthZEN evaluation");
  }
  const context=raw.context as Record<string,unknown>|undefined;
  if(context && Object.keys(context).some(k=>!["awc_proposal_id","awc_proposal_revision"].includes(k))) {
    throw new AuthzenError("invalid_request","Unsupported AWC PDP context field");
  }
  return {
    subject:readEntity(raw.subject),
    action:{name:raw.action.name,
      ...(raw.action.properties===undefined?{}:{properties:raw.action.properties as Record<string,unknown>})},
    resource:readEntity(raw.resource),
    ...(context?{context}:{})
  };
}
export function actionToAuthzen(proposal:ActionProposal):AuthzenEvaluationRequest {
  return {
    subject:{type:"identity",id:proposal.actorId},
    action:{name:proposal.action},
    resource:{type:"awc-managed-entity",id:proposal.entityId},
    context:{
      awc_proposal_id:proposal.id,
      awc_proposal_revision:proposal.revision,
    },
  };
}
const refuse=(reason:string,detail?:PolicyDecision):AuthzenDecision => ({
  decision:false,
  context:{
    awc_reason_codes:detail?.reasonCodes??[reason],
    awc_decision_kind:detail?.kind??"deny",
    ...(detail?.kind==="escalate"?{awc_required_approvers:detail.requiredApprovers}:{}),
  },
});

/**
 * AuthZEN is a PDP protocol, not a money reservation.
 * Only an unconditionally permitted read/plan can return true. Conditional
 * writes require a separate reviewed transaction/commit path and return deny.
 */
export function createAuthzenPdp(
  resolver:AuthzenResolver,
  options:{readonly conditionalVerifier?:ConditionalAuthorizationVerifier}={}
) {
  return {
    async evaluate(raw:unknown,caller:VerifiedPdpCaller):Promise<AuthzenDecision> {
      const request=parseAuthzenEvaluation(raw);
      if(request.subject.type!=="identity"||request.subject.id!==caller.subjectId||
        request.resource.type!=="awc-managed-entity")return refuse("UNTRUSTED_SUBJECT_OR_RESOURCE");
      const ref=request.context?.awc_proposal_id;
      const revision=request.context?.awc_proposal_revision;
      if(!bounded(ref)||typeof revision!=="string"||!/^[a-f0-9]{64}$/.test(revision)) {
        return refuse("MISSING_PROPOSAL_BINDING");
      }
      let trusted:AuthoritativeProposal|undefined;
      try{trusted=await resolver.resolve(ref,caller);}catch{return refuse("TRUSTED_RESOLVER_UNAVAILABLE");}
      if(!trusted)return refuse("PROPOSAL_NOT_FOUND");
      const {proposal,policy}=trusted;
      if(proposal.id!==ref||proposal.revision!==revision||proposal.actorId!==caller.subjectId ||
        proposal.entityId!==request.resource.id||proposal.action!==request.action.name) {
        return refuse("AUTHORITATIVE_PROPOSAL_MISMATCH");
      }
      try {await assertActionRevision(proposal);}catch{return refuse("PROPOSAL_DIGEST_MISMATCH");}
      let outcome:PolicyDecision;
      try{outcome=evaluateAction(proposal,policy);}catch{return refuse("POLICY_EVALUATION_FAILED");}
      // A conditional authorization may turn into allow only when a trusted,
      // separately authenticated resource/financial gateway verifies that ALL
      // conditions are already fulfilled for this exact action revision.
      if(outcome.kind==="permit-with-conditions" && options.conditionalVerifier){
        let proof:TrustedConditionalAuthorization|undefined;
        try{proof=await options.conditionalVerifier.verify(trusted,caller);}catch{
          return refuse("CONDITIONAL_VERIFIER_UNAVAILABLE",outcome);
        }
        if(proof&&proof.proposalId===proposal.id&&proof.revision===proposal.revision &&
          proof.actorId===proposal.actorId&&proof.entityId===proposal.entityId &&
          proof.action===proposal.action&&Number.isFinite(Date.parse(proof.expiresAt)) &&
          Date.parse(proof.expiresAt)>Date.parse(policy.now) &&
          Date.parse(proof.expiresAt)<=Date.parse(outcome.validUntil)){
          return {decision:true,context:{
            awc_decision_kind:"verified-conditional-authorization",
            awc_action_revision:proposal.revision,
            awc_expires_at:proof.expiresAt,
            awc_note:"PEP must atomically recheck and consume one-time external authority",
          }};
        }
        return refuse("CONDITIONS_NOT_VERIFIED",outcome);
      }
      // "permit-with-conditions" is *not* equivalent to unconditional AuthZEN allow.
      if(outcome.kind!=="permit")return refuse(
        outcome.kind==="permit-with-conditions"?"AWC_CONDITIONAL_COMMIT_REQUIRED":"AUTHORIZATION_DENIED",
        outcome,
      );
      return {decision:true,context:{awc_decision_kind:"permit",awc_reason_codes:outcome.reasonCodes}};
    },
  };
}
export function authzenMetadata(pdpOrigin:string) {
  const u=new URL(pdpOrigin);
  if((u.protocol!=="https:" && !(u.protocol==="http:"&&["localhost","127.0.0.1"].includes(u.hostname)))||
    u.search||u.hash||u.pathname!=="/") {
    throw new AuthzenError("invalid_request","PDP origin must be HTTPS without path/query");
  }
  const base=u.origin;
  return {policy_decision_point:base,access_evaluation_endpoint:base+"/access/v1/evaluation"};
}
