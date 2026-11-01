-- Immutable remote execution request, idempotency key, provider handle and reconciled result.
-- All changes use version-checked D1 compare-and-swap; external calls happen after committing a lease.
CREATE TABLE IF NOT EXISTS awc_dispatch (
  work_id TEXT PRIMARY KEY REFERENCES awc_work_orders(id),
  buyer_id TEXT NOT NULL,
  executor_id TEXT NOT NULL,
  request_digest TEXT NOT NULL,
  status TEXT NOT NULL,
  version INTEGER NOT NULL,
  lease_until INTEGER NOT NULL DEFAULT 0,
  next_check_at INTEGER NOT NULL DEFAULT 0,
  payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_awc_dispatch_due
  ON awc_dispatch(status,lease_until,next_check_at);
CREATE INDEX IF NOT EXISTS idx_awc_dispatch_buyer
  ON awc_dispatch(buyer_id,work_id);
