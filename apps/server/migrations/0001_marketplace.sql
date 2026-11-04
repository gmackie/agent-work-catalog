-- Internal sandbox work catalog only. Do not add production payments before accounting review.
CREATE TABLE IF NOT EXISTS awc_quotes (
  id TEXT PRIMARY KEY,
  buyer_id TEXT NOT NULL,
  idem_key TEXT NOT NULL,
  digest TEXT NOT NULL,
  payload TEXT NOT NULL,
  UNIQUE (buyer_id, idem_key)
);
CREATE INDEX IF NOT EXISTS idx_awc_quotes_buyer ON awc_quotes (buyer_id, id);
CREATE TABLE IF NOT EXISTS awc_work_orders (
  id TEXT PRIMARY KEY,
  buyer_id TEXT NOT NULL,
  idem_key TEXT NOT NULL,
  digest TEXT NOT NULL,
  quote_id TEXT NOT NULL,
  payload TEXT NOT NULL,
  UNIQUE (buyer_id, idem_key),
  FOREIGN KEY (quote_id) REFERENCES awc_quotes(id)
);
CREATE INDEX IF NOT EXISTS idx_awc_work_orders_buyer ON awc_work_orders (buyer_id, id);
