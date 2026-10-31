-- Separate commercial lifecycle from prepared work and MCP task handles.
-- State changes are committed with version-checked atomic SQLite UPDATE.
CREATE TABLE IF NOT EXISTS awc_commerce_state (
  id TEXT PRIMARY KEY REFERENCES awc_work_orders(id),
  buyer_id TEXT NOT NULL,
  status TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 0,
  lease_until INTEGER,
  payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_awc_commerce_recovery ON awc_commerce_state(status,lease_until);
