-- Deterministic read-only example. Persist accepted idempotency and its result.
CREATE TABLE IF NOT EXISTS awc_example_executions (
  provider_id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  request_digest TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_awc_example_client ON awc_example_executions(client_id);
