-- Trusted read-only PDP projection. Only a separately authenticated issuer/control-plane
-- service may INSERT/UPDATE these tables. The public MCP and PDP endpoints never write.
-- This schema alone does not cryptographically establish issuer identity.
CREATE TABLE IF NOT EXISTS awc_trusted_mandates(
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  payload TEXT NOT NULL,
  issuer_registration_id TEXT NOT NULL,
  revoked_at TEXT,
  PRIMARY KEY(tenant_id,id)
);
CREATE TABLE IF NOT EXISTS awc_trusted_proposals(
  tenant_id TEXT NOT NULL,
  proposal_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  payload TEXT NOT NULL,
  registered_by TEXT NOT NULL,
  PRIMARY KEY(tenant_id,proposal_id)
);
CREATE INDEX IF NOT EXISTS idx_awc_trusted_proposals_actor
 ON awc_trusted_proposals(tenant_id,actor_id,proposal_id);
CREATE TABLE IF NOT EXISTS awc_trusted_entities(
  tenant_id TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  observation_version TEXT,
  observed_at TEXT,
  observation_source_id TEXT,
  PRIMARY KEY(tenant_id,entity_id)
);
CREATE TABLE IF NOT EXISTS awc_trusted_owner_grants(
  tenant_id TEXT NOT NULL,
  grant_id TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  actions_json TEXT NOT NULL,
  valid_until TEXT NOT NULL,
  registered_by TEXT NOT NULL,
  revoked_at TEXT,
  PRIMARY KEY(tenant_id,grant_id)
);
CREATE INDEX IF NOT EXISTS idx_awc_trusted_owner_entity
 ON awc_trusted_owner_grants(tenant_id,entity_id,revoked_at);
CREATE TABLE IF NOT EXISTS awc_trusted_action_policies(
  tenant_id TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL,
  risk TEXT NOT NULL,
  effects_json TEXT NOT NULL,
  registered_by TEXT NOT NULL,
  active INTEGER NOT NULL CHECK(active IN(0,1)),
  PRIMARY KEY(tenant_id,entity_id,action)
);
CREATE TABLE IF NOT EXISTS awc_trusted_approvals(
  tenant_id TEXT NOT NULL,
  approval_id TEXT NOT NULL,
  proposal_id TEXT NOT NULL,
  revision TEXT NOT NULL,
  approver_id TEXT NOT NULL,
  valid_until TEXT NOT NULL,
  registered_by TEXT NOT NULL,
  revoked_at TEXT,
  PRIMARY KEY(tenant_id,approval_id)
);
CREATE INDEX IF NOT EXISTS idx_awc_trusted_approvals_proposal
 ON awc_trusted_approvals(tenant_id,proposal_id,revoked_at);
