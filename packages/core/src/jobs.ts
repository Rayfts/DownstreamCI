import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";

export type CoordinatorJobStatus = "queued" | "running" | "completed" | "failed";

export interface CoordinatorJobInput {
  id: string;
  owner: string;
  repo: string;
  headSha: string;
  pullNumber: number;
  installationId: number;
  checkRunId: number;
}

export interface CoordinatorJob extends CoordinatorJobInput {
  status: CoordinatorJobStatus;
  createdAt: number;
  updatedAt: number;
  workerId?: string;
  leaseUntil?: number;
}

interface JobRow {
  id: string;
  owner: string;
  repo: string;
  head_sha: string;
  pull_number: number;
  installation_id: number;
  check_run_id: number;
  status: CoordinatorJobStatus;
  created_at: number;
  updated_at: number;
  worker_id: string | null;
  lease_until: number | null;
}

export class CoordinatorJobStore {
  private readonly sqlite: Database.Database;

  constructor(path = ".downstreamci/downstreamci.db") {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.sqlite = new Database(path);
    this.sqlite.pragma("journal_mode = WAL");
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS coordinator_jobs (
        id TEXT PRIMARY KEY,
        owner TEXT NOT NULL,
        repo TEXT NOT NULL,
        head_sha TEXT NOT NULL,
        pull_number INTEGER NOT NULL,
        installation_id INTEGER NOT NULL,
        check_run_id INTEGER NOT NULL,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        worker_id TEXT,
        lease_until INTEGER
      );
      CREATE INDEX IF NOT EXISTS coordinator_jobs_claim_idx
        ON coordinator_jobs(status, lease_until, created_at);
    `);
  }

  enqueue(input: CoordinatorJobInput): CoordinatorJob {
    const now = Date.now();
    this.sqlite
      .prepare(`
        INSERT INTO coordinator_jobs (
          id, owner, repo, head_sha, pull_number, installation_id, check_run_id,
          status, created_at, updated_at, worker_id, lease_until
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?, NULL, NULL)
      `)
      .run(
        input.id,
        input.owner,
        input.repo,
        input.headSha,
        input.pullNumber,
        input.installationId,
        input.checkRunId,
        now,
        now,
      );
    const job = this.get(input.id);
    if (!job) throw new Error(`Unable to read queued job ${input.id}`);
    return job;
  }

  get(id: string): CoordinatorJob | null {
    const row = this.sqlite.prepare("SELECT * FROM coordinator_jobs WHERE id = ?").get(id) as JobRow | undefined;
    return row ? fromRow(row) : null;
  }

  claim(workerId: string, leaseSeconds = 900): CoordinatorJob | null {
    const transaction = this.sqlite.transaction(() => {
      const now = Date.now();
      const row = this.sqlite
        .prepare(`
          SELECT * FROM coordinator_jobs
          WHERE status = 'queued'
             OR (status = 'running' AND lease_until IS NOT NULL AND lease_until < ?)
          ORDER BY created_at ASC
          LIMIT 1
        `)
        .get(now) as JobRow | undefined;
      if (!row) return null;
      const leaseUntil = now + Math.max(60, Math.min(3600, leaseSeconds)) * 1000;
      this.sqlite
        .prepare(`
          UPDATE coordinator_jobs
          SET status = 'running', worker_id = ?, lease_until = ?, updated_at = ?
          WHERE id = ?
        `)
        .run(workerId, leaseUntil, now, row.id);
      return this.get(row.id);
    });
    return transaction.immediate();
  }

  finish(id: string, status: Extract<CoordinatorJobStatus, "completed" | "failed">): CoordinatorJob | null {
    this.sqlite
      .prepare(`
        UPDATE coordinator_jobs
        SET status = ?, worker_id = NULL, lease_until = NULL, updated_at = ?
        WHERE id = ?
      `)
      .run(status, Date.now(), id);
    return this.get(id);
  }

  close(): void {
    this.sqlite.close();
  }
}

function fromRow(row: JobRow): CoordinatorJob {
  return {
    id: row.id,
    owner: row.owner,
    repo: row.repo,
    headSha: row.head_sha,
    pullNumber: row.pull_number,
    installationId: row.installation_id,
    checkRunId: row.check_run_id,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.worker_id ? { workerId: row.worker_id } : {}),
    ...(row.lease_until === null ? {} : { leaseUntil: row.lease_until }),
  };
}
