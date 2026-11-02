import type { AuthzenDecision, AuthzenEvaluationRequest } from "@awc/authzen";

/** Narrow, reviewed subset of the OpenID COAZ-MCP draft default mapping.
 * No CEL evaluator and NO claim of full draft conformance. */
export interface VerifiedMcpActor {
  readonly subjectId:string;  // Verified access-token sub
  readonly clientId:string;   // Verified client identity
  readonly audience:string;   // Validated MCP resource indicator
}
export interface McpInvocation {
  readonly method:"tools/call";
  readonly params:{readonly name:string;readonly arguments?:Readonly<Record<string,unknown>>};
}
export interface ToolPolicy {
  readonly name:string;
  readonly requiredScope?:string;
  /** If true, a successful generic tools/call PDP response still requires AWC resource policy. */
  readonly requiresObjectDecision:boolean;
}
export type McpPolicyFn=(request:AuthzenEvaluationRequest)=>Promise<AuthzenDecision>;
export class CoazError extends Error {
  constructor(readonly code:"denied"|"unmapped"|"unavailable",message:string){
    super(message);this.name="CoazError";
  }
}
/** Default tools/call maps to action name tools/call and resource {type:tool,id:toolName}. */
export function mapToolCall(invocation:McpInvocation,actor:VerifiedMcpActor):AuthzenEvaluationRequest {
  if(!actor.subjectId||!actor.clientId||!actor.audience||!invocation.params.name ||
    invocation.params.name.length>150)throw new CoazError("unmapped","Invalid caller or tool identity");
  return {
    subject:{type:"identity",id:actor.subjectId},
    action:{name:"tools/call"},
    resource:{type:"tool",id:invocation.params.name},
    context:{agent:actor.clientId},
  };
}
/** A conservative PEP. Unreviewed tools and parameter-dependent mutations fail closed. */
export async function authorizeToolCall(
  invocation:McpInvocation,
  actor:VerifiedMcpActor,
  toolPolicy:readonly ToolPolicy[],
  scopes:readonly string[],
  pdp:McpPolicyFn,
):Promise<AuthzenDecision> {
  const entry=toolPolicy.find(p=>p.name===invocation.params.name);
  if(!entry)throw new CoazError("unmapped","Unknown tool has no reviewed authorization mapping");
  if(entry.requiredScope && !scopes.includes(entry.requiredScope))throw new CoazError("denied","Missing tool scope");
  const req=mapToolCall(invocation,actor);
  let response:AuthzenDecision;
  try{response=await pdp(req);}catch{
    throw new CoazError("unavailable","Authorization PDP unavailable");
  }
  if(!response.decision)throw new CoazError("denied","Policy denied tool call");
  if(entry.requiresObjectDecision)throw new CoazError("denied",
    "Object-level authorization/commit must occur in the domain service");
  return response;
}

/**
 * COAZ-MCP reviewed declared-mapping subset. Mapping belongs to an operator,
 * not to caller arguments or an unreviewed tool schema. The source/args are
 * normalized before selecting the action/resource to prevent target confusion.
 */
export interface ReviewedToolMapping {
  readonly toolName:string;
  readonly action:string;
  readonly resourceParam?:string;
  readonly fixedResource?:string;
  readonly resourceType:"gatekeeper-resource";
}
const actionKey=/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)+$/;
const safeName=(s:string)=>s.length>0&&s.length<=256&&!/[\u0000-\u001f]/.test(s);
export function mapReviewedToolCall(
  invocation:McpInvocation,
  actor:VerifiedMcpActor,
  mappings:readonly ReviewedToolMapping[],
):AuthzenEvaluationRequest {
  if(!actor.subjectId||!actor.clientId||!actor.audience)throw new CoazError("unmapped","Unverified MCP caller");
  const matching=mappings.filter(m=>m.toolName===invocation.params.name);
  if(matching.length!==1)throw new CoazError("unmapped","Tool has no unique reviewed COAZ mapping");
  const rule=matching[0]!;
  if(!actionKey.test(rule.action)||!!rule.resourceParam===!!rule.fixedResource){
    throw new CoazError("unmapped","Reviewed tool mapping invalid");
  }
  const resource=rule.resourceParam?invocation.params.arguments?.[rule.resourceParam]:rule.fixedResource;
  if(typeof resource!=="string"||!safeName(resource))throw new CoazError("unmapped","No valid mapped resource");
  return {
    subject:{type:"identity",id:actor.subjectId},
    action:{name:rule.action},
    resource:{type:rule.resourceType,id:resource},
    // Only purpose is admitted by first Gatekeeper AuthZEN profile.
    // Client/tenant are verified independently by the PDP token and PIP.
    context:{purpose:"awc-mcp:"+rule.toolName},
  };
}
/** These are safe initial mappings, not Gatekeeper policy grants.
 * Policies must be installed in the Gatekeeper reviewed action catalog. */
export const AWC_REVIEWED_TOOL_MAPPINGS:readonly ReviewedToolMapping[]=[
  {toolName:"quotes.request",action:"awc.quotes.request",
   resourceParam:"offeringId",resourceType:"gatekeeper-resource"},
  {toolName:"work.prepare",action:"awc.work.prepare",
   resourceParam:"quoteId",resourceType:"gatekeeper-resource"},
  {toolName:"work.get",action:"awc.work.read",
   resourceParam:"workId",resourceType:"gatekeeper-resource"},
  {toolName:"work.start",action:"awc.work.start",
   resourceParam:"workId",resourceType:"gatekeeper-resource"},
  {toolName:"billing.options",action:"awc.billing.options",
   fixedResource:"awc-billing-options",resourceType:"gatekeeper-resource"},
  {toolName:"billing.checkout",action:"awc.billing.checkout",
   resourceParam:"workId",resourceType:"gatekeeper-resource"},
  {toolName:"billing.reconcile",action:"awc.billing.reconcile",
   resourceParam:"workId",resourceType:"gatekeeper-resource"},
];
