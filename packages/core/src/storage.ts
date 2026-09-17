import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import type { Comparison } from "./types.js";

export const runs = sqliteTable("runs", {
  id: text("id").primaryKey(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  upstream: text("upstream").notNull(),
  ref: text("ref").notNull(),
  payload: text("payload").notNull(),
});

export interface StoredRun {
  id: string;
  createdAt: number;
  upstream: string;
  ref: string;
  comparisons: Comparison[];
}

export class RunStore {
  private readonly sqlite: Database.Database;
  readonly db: ReturnType<typeof drizzle>;

  constructor(path = ".downstreamci/downstreamci.db") {
    mkdirSync(dirname(path), { recursive: true });
    this.sqlite = new Database(path);
    this.sqlite.pragma("journal_mode = WAL");
    this.sqlite.exec(
      "CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, created_at INTEGER NOT NULL, upstream TEXT NOT NULL, ref TEXT NOT NULL, payload TEXT NOT NULL)",
    );
    this.db = drizzle(this.sqlite);
  }

  save(id: string, upstream: string, ref: string, comparisons: Comparison[]): void {
    this.sqlite
      .prepare("INSERT OR REPLACE INTO runs (id, created_at, upstream, ref, payload) VALUES (?, ?, ?, ?, ?)")
      .run(id, Date.now(), upstream, ref, JSON.stringify(comparisons));
  }

  get(id: string): Comparison[] | null {
    const row = this.sqlite.prepare("SELECT payload FROM runs WHERE id = ?").get(id) as
      | { payload: string }
      | undefined;
    return row ? (JSON.parse(row.payload) as Comparison[]) : null;
  }

  latest(limit = 20): StoredRun[] {
    const safeLimit = Math.max(1, Math.min(100, Math.trunc(limit)));
    const rows = this.sqlite
      .prepare("SELECT id, created_at, upstream, ref, payload FROM runs ORDER BY created_at DESC LIMIT ?")
      .all(safeLimit) as Array<{ id: string; created_at: number; upstream: string; ref: string; payload: string }>;
    return rows.map((row) => ({
      id: row.id,
      createdAt: row.created_at,
      upstream: row.upstream,
      ref: row.ref,
      comparisons: JSON.parse(row.payload) as Comparison[],
    }));
  }

  close(): void {
    this.sqlite.close();
  }
}
