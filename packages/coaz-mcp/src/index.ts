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
