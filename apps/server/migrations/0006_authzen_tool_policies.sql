-- Reviewed MCP policy admission is independent of OAuth scopes and resource permissions.
-- Only an authorized internal configuration plane may install these records.
CREATE TABLE IF NOT EXISTS awc_trusted_mcp_tool_policies(
  tenant_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  required_scope TEXT NOT NULL,
  active INTEGER NOT NULL CHECK(active IN(0,1)),
  object_check_required INTEGER NOT NULL CHECK(object_check_required IN(0,1)),
  reviewed_by TEXT NOT NULL,
  PRIMARY KEY(tenant_id,client_id,tool_name)
);
