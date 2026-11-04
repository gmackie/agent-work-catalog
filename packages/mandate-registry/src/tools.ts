import type { AuthzenDecision, AuthzenEvaluationRequest } from "@awc/authzen";

/** The identity is derived from a validated MCP/OIDC token, never tool parameters. */
export interface TrustedToolCaller {
  readonly subjectId:string;
  readonly clientId:string;
  readonly tenantId:string;
  readonly scopes:readonly string[];
}
export interface ToolPolicyRow {
  readonly tenantId:string;
  readonly clientId:string;
  readonly toolName:string;
  readonly requiredScope:string;
  readonly active:boolean;
  readonly objectCheckRequired:boolean;
}
export interface ToolPolicyRegistry {
  lookup(tenantId:string,clientId:string,toolName:string):Promise<ToolPolicyRow|undefined>;
}
const deny=(code:string):AuthzenDecision=>({
  decision:false,context:{awc_reason_codes:[code]},
});
export function createTrustedMcpToolPdp(store:ToolPolicyRegistry) {
  return {
    async evaluate(request:AuthzenEvaluationRequest,caller:TrustedToolCaller):Promise<AuthzenDecision> {
      if(request.subject.type!=="identity"||request.subject.id!==caller.subjectId||
        request.action.name!=="tools/call"||
        request.resource.type!=="tool"||
        request.context?.agent!==caller.clientId){
        return deny("MCP_ACTOR_OR_ACTION_MISMATCH");
      }
      let policy:ToolPolicyRow|undefined;
      try {policy=await store.lookup(caller.tenantId,caller.clientId,request.resource.id);}
      catch{return deny("TOOL_POLICY_UNAVAILABLE");}
      if(!policy||!policy.active ||
        policy.tenantId!==caller.tenantId ||
        policy.clientId!==caller.clientId ||
        policy.toolName!==request.resource.id ||
        !policy.requiredScope || !caller.scopes.includes(policy.requiredScope)){
        return deny("TOOL_POLICY_DENIED");
      }
      return {decision:true,context:{
        awc_decision_kind:"tool-admission",
        awc_object_check_required:policy.objectCheckRequired,
        awc_note:"Domain service must enforce resource ownership, funding and state independently.",
      }};
    }
  };
}
