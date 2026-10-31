-- Ingress event receipts are distinct from commercial WorkOrders.
-- GitHub redeliveries reuse X-GitHub-Delivery; signature validation occurs before this transaction.
CREATE TABLE IF NOT EXISTS awc_inbound_events (
  source_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  digest TEXT NOT NULL,
  received_at TEXT NOT NULL,
  PRIMARY KEY(source_id,event_id)
);
CREATE TABLE IF NOT EXISTS awc_opportunities (
  id TEXT PRIMARY KEY,
  buyer_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  payload TEXT NOT NULL,
  first_seen_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_awc_opportunities_buyer
  ON awc_opportunities(buyer_id,first_seen_at);
