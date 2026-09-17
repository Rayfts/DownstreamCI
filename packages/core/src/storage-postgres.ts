import { drizzle } from "drizzle-orm/postgres-js";
import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import postgres from "postgres";
import { sanitizeComparisonsForStorage } from "./reporting.js";
import { aggregateHistorySignals, type HistorySignals, type StoredRun } from "./storage.js";
import type { Comparison } from "./types.js";

export const distributedRuns = pgTable("runs", {
  id: text("id").primaryKey(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  upstream: text("upstream").notNull(),
  ref: text("ref").notNull(),
  payload: text("payload").notNull(),
});

export class PostgresRunStore {
  private readonly client: ReturnType<typeof postgres>;
  readonly db: ReturnType<typeof drizzle>;
  private initialized = false;

  constructor(url: string) {
    this.client = postgres(url, { max: 5, idle_timeout: 20, connect_timeout: 10 });
    this.db = drizzle(this.client);
  }

  private async initialize(): Promise<void> {
    if (this.initialized) return;
    await this.client`
      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY,
        created_at TIMESTAMPTZ NOT NULL,
        upstream TEXT NOT NULL,
        ref TEXT NOT NULL,
        payload TEXT NOT NULL
      )
    `;
    this.initialized = true;
  }

  async save(id: string, upstream: string, ref: string, comparisons: Comparison[]): Promise<void> {
    await this.initialize();
    const payload = JSON.stringify(sanitizeComparisonsForStorage(comparisons));
    await this.client`
      INSERT INTO runs (id, created_at, upstream, ref, payload)
      VALUES (${id}, NOW(), ${upstream}, ${ref}, ${payload})
      ON CONFLICT (id) DO UPDATE SET
        created_at = EXCLUDED.created_at,
        upstream = EXCLUDED.upstream,
        ref = EXCLUDED.ref,
        payload = EXCLUDED.payload
    `;
  }

  async get(id: string): Promise<Comparison[] | null> {
    await this.initialize();
    const rows = await this.client`SELECT payload FROM runs WHERE id = ${id} LIMIT 1`;
    const row = rows[0] as { payload?: unknown } | undefined;
    return typeof row?.payload === "string" ? (JSON.parse(row.payload) as Comparison[]) : null;
  }

  async latest(limit = 20): Promise<StoredRun[]> {
    await this.initialize();
    const safeLimit = Math.max(1, Math.min(100, Math.trunc(limit)));
    const rows = await this.client`
      SELECT id, created_at, upstream, ref, payload
      FROM runs
      ORDER BY created_at DESC
      LIMIT ${safeLimit}
    `;
    return rows.map((value) => {
      const row = value as {
        id: string;
        created_at: Date | string;
        upstream: string;
        ref: string;
        payload: string;
      };
      return {
        id: row.id,
        createdAt: new Date(row.created_at).getTime(),
        upstream: row.upstream,
        ref: row.ref,
        comparisons: JSON.parse(row.payload) as Comparison[],
      };
    });
  }

  async signals(limit = 100): Promise<HistorySignals> {
    return aggregateHistorySignals(await this.latest(limit));
  }

  async close(): Promise<void> {
    await this.client.end({ timeout: 5 });
  }
}
