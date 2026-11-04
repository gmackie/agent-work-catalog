import type { ToolPolicyRegistry,ToolPolicyRow } from "./tools.ts";
import type { D1Database } from "./d1.ts";
type Row={tenant_id:string;client_id:string;tool_name:string;required_scope:string;active:number;object_check_required:number};
/** Read-only policy registry. Admin tooling must verify authority before writing rows. */
export function d1McpToolPolicies(db:D1Database):ToolPolicyRegistry {
 return {lookup:async(tenantId,clientId,toolName)=>{
  if(!tenantId||!clientId||!toolName||tenantId.length>200||
     clientId.length>200||toolName.length>200)return undefined;
  const row=await db.prepare(
    "SELECT tenant_id,client_id,tool_name,required_scope,active,object_check_required "+
    "FROM awc_trusted_mcp_tool_policies WHERE tenant_id=? AND client_id=? AND tool_name=?"
  ).bind(tenantId,clientId,toolName).first<Row>();
  if(!row)return undefined;
  return {tenantId:row.tenant_id,clientId:row.client_id,toolName:row.tool_name,
   requiredScope:row.required_scope,active:row.active===1,
   objectCheckRequired:row.object_check_required===1};
 }};
}
