import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { sanitizeComparisonsForStorage } from "./reporting.js";
import type { Classification, Comparison } from "./types.js";

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

export interface DownstreamSignal {
  repository: string;
  runs: number;
  regressions: number;
  flaky: number;
  baselineFailing: number;
  unaffected: number;
  highSignalScore: number;
}

export interface ClusterSignal {
  id: string;
  label: string;
  occurrences: number;
  repositories: string[];
}

export interface HistorySignals {
  downstreams: DownstreamSignal[];
  clusters: ClusterSignal[];
  classifications: Record<Classification, number>;
  ecosystems: Record<string, Record<Classification, number>>;
  runtimes: Record<string, Record<string, number>>;
}

export class RunStore {
  private readonly sqlite: Database.Database;
  readonly db: ReturnType<typeof drizzle>;

  constructor(path = ".downstreamci/downstreamci.db") {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.sqlite = new Database(path);
    this.sqlite.pragma("journal_mode = WAL");
    this.sqlite.exec(
      "CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, created_at INTEGER NOT NULL, upstream TEXT NOT NULL, ref TEXT NOT NULL, payload TEXT NOT NULL)",
    );
    this.db = drizzle(this.sqlite);
  }

  save(id: string, upstream: string, ref: string, comparisons: Comparison[]): void {
    const payload = JSON.stringify(sanitizeComparisonsForStorage(comparisons));
    this.sqlite
      .prepare("INSERT OR REPLACE INTO runs (id, created_at, upstream, ref, payload) VALUES (?, ?, ?, ?, ?)")
      .run(id, Date.now(), upstream, ref, payload);
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
    return rows.map(parseStoredRun);
  }

  signals(limit = 100): HistorySignals {
    return aggregateHistorySignals(this.latest(limit));
  }

  close(): void {
    this.sqlite.close();
  }
}

export function aggregateHistorySignals(history: StoredRun[]): HistorySignals {
  const downstreams = new Map<string, DownstreamSignal>();
  const clusters = new Map<string, { id: string; label: string; occurrences: number; repositories: Set<string> }>();
  const classifications = emptyClassificationCounts();
  const ecosystems: Record<string, Record<Classification, number>> = {};
  const runtimes: Record<string, Record<string, number>> = {};

  for (const run of history) {
    for (const comparison of run.comparisons) {
      classifications[comparison.classification] += 1;
      const repository = comparison.downstream?.repository ?? "unknown";
      const signal = downstreams.get(repository) ?? {
        repository,
        runs: 0,
        regressions: 0,
        flaky: 0,
        baselineFailing: 0,
        unaffected: 0,
        highSignalScore: 0,
      };
      signal.runs += 1;
      if (comparison.classification === "newly-broken") signal.regressions += 1;
      if (comparison.classification === "flaky") signal.flaky += 1;
      if (comparison.classification === "baseline-failing") signal.baselineFailing += 1;
      if (comparison.classification === "unaffected") signal.unaffected += 1;
      signal.highSignalScore = Math.max(0, signal.runs - signal.flaky - signal.baselineFailing) / signal.runs;
      downstreams.set(repository, signal);

      const ecosystem = comparison.downstream?.ecosystem ?? "unknown";
      const ecosystemCounts = ecosystems[ecosystem] ?? emptyClassificationCounts();
      ecosystemCounts[comparison.classification] += 1;
      ecosystems[ecosystem] = ecosystemCounts;

      for (const [runtime, version] of Object.entries(comparison.candidate.environment)) {
        const versions = runtimes[runtime] ?? {};
        versions[version] = (versions[version] ?? 0) + 1;
        runtimes[runtime] = versions;
      }

      if (comparison.cluster) {
        const cluster = clusters.get(comparison.cluster.id) ?? {
          id: comparison.cluster.id,
          label: comparison.cluster.label,
          occurrences: 0,
          repositories: new Set<string>(),
        };
        cluster.occurrences += 1;
        cluster.repositories.add(repository);
        clusters.set(cluster.id, cluster);
      }
    }
  }

  return {
    downstreams: [...downstreams.values()].sort(
      (a, b) => b.highSignalScore - a.highSignalScore || b.runs - a.runs || a.repository.localeCompare(b.repository),
    ),
    clusters: [...clusters.values()]
      .map((cluster) => ({ ...cluster, repositories: [...cluster.repositories].sort() }))
      .sort((a, b) => b.occurrences - a.occurrences || a.id.localeCompare(b.id)),
    classifications,
    ecosystems,
    runtimes,
  };
}

function parseStoredRun(row: { id: string; created_at: number; upstream: string; ref: string; payload: string }): StoredRun {
  return {
    id: row.id,
    createdAt: row.created_at,
    upstream: row.upstream,
    ref: row.ref,
    comparisons: JSON.parse(row.payload) as Comparison[],
  };
}

function emptyClassificationCounts(): Record<Classification, number> {
  return {
    unaffected: 0,
    "newly-broken": 0,
    "baseline-failing": 0,
    flaky: 0,
    "infrastructure-failure": 0,
    "setup-failure": 0,
    improved: 0,
    inconclusive: 0,
  };
}
