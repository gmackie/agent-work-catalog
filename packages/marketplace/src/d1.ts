import { MarketplaceError, type MarketplaceStore, type Quote, type PreparedWork } from "./index.ts";

export interface D1Statement {
  bind(...args: (string | number | null)[]): D1Statement;
  run(): Promise<unknown>;
  first<T>(): Promise<T | null>;
}
export interface D1Database {
  prepare(sql: string): D1Statement;
}
interface Row { payload: string; digest: string; }

/** Atomic uniqueness is enforced in D1 schema, not by in-memory locks. */
export function d1MarketplaceStore(db: D1Database): MarketplaceStore {
  return {
    putQuote: async (quote) => {
      await db.prepare("INSERT OR IGNORE INTO awc_quotes (id, buyer_id, idem_key, digest, payload) VALUES (?, ?, ?, ?, ?)")
        .bind(quote.id, quote.buyerId, quote.idempotencyKey, quote.requestDigest, JSON.stringify(quote)).run();
      const row = await db.prepare("SELECT payload, digest FROM awc_quotes WHERE buyer_id = ? AND idem_key = ?")
        .bind(quote.buyerId, quote.idempotencyKey).first<Row>();
      if (!row) throw new MarketplaceError("unavailable", "Quote persistence failed");
      if (row.digest !== quote.requestDigest) throw new MarketplaceError("conflict", "Quote idempotency key reused");
      return JSON.parse(row.payload) as Quote;
    },
    getQuote: async (buyerId, id) => {
      const row = await db.prepare("SELECT payload, digest FROM awc_quotes WHERE buyer_id = ? AND id = ?")
        .bind(buyerId, id).first<Row>();
      return row ? JSON.parse(row.payload) as Quote : undefined;
    },
    putWork: async (work) => {
      const digest = work.quoteDigest + ":" + work.inputDigest + ":" + work.quoteId;
      await db.prepare("INSERT OR IGNORE INTO awc_work_orders (id, buyer_id, idem_key, digest, quote_id, payload) VALUES (?, ?, ?, ?, ?, ?)")
        .bind(work.id, work.buyerId, work.idempotencyKey, digest, work.quoteId, JSON.stringify(work)).run();
      const row = await db.prepare("SELECT payload, digest FROM awc_work_orders WHERE buyer_id = ? AND idem_key = ?")
        .bind(work.buyerId, work.idempotencyKey).first<Row>();
      if (!row) throw new MarketplaceError("unavailable", "Work persistence failed");
      if (row.digest !== digest) throw new MarketplaceError("conflict", "Work idempotency key reused");
      return JSON.parse(row.payload) as PreparedWork;
    },
    getWork: async (buyerId, id) => {
      const row = await db.prepare("SELECT payload, digest FROM awc_work_orders WHERE buyer_id = ? AND id = ?")
        .bind(buyerId, id).first<Row>();
      return row ? JSON.parse(row.payload) as PreparedWork : undefined;
    },
  };
}
