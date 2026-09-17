import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  checkoutRepository,
  executeConfiguredPipeline,
  loadConfig,
  type Comparison,
} from "@downstreamci/core";

interface WorkerJob {
  id: string;
  owner: string;
  repo: string;
  headSha: string;
  pullNumber: number;
}

interface CoordinatorConfig {
  url: string;
  token: string;
  workerId: string;
  pollMs: number;
  runnerImage: string;
  retries: number;
}

export async function runCoordinatorLoop(signal?: AbortSignal): Promise<void> {
  const config = coordinatorConfig();
  while (!signal?.aborted) {
    try {
      const job = await claimJob(config);
      if (!job) {
        await sleep(config.pollMs, signal);
        continue;
      }
      try {
        const result = await executeJob(job, config);
        await completeJob(config, job.id, result);
      } catch (error) {
        await failJob(config, job.id, error instanceof Error ? error.message : String(error));
      }
    } catch (error) {
      console.error(`coordinator loop error: ${error instanceof Error ? error.message : String(error)}`);
      await sleep(config.pollMs, signal);
    }
  }
}

async function executeJob(
  job: WorkerJob,
  config: CoordinatorConfig,
): Promise<{ runId: string; upstream: string; ref: string; comparisons: Comparison[] }> {
  const workspaceRoot = await workerRoot();
  const temporary = await mkdtemp(join(workspaceRoot, "coordinator-job-"));
  try {
    const upstreamName = `${job.owner}/${job.repo}`;
    const upstream = await checkoutRepository(upstreamName, job.headSha, temporary, "upstream");
    const downstreamConfig = await loadConfig(join(upstream, ".downstreamci.yml"));
    const comparisons = await executeConfiguredPipeline(upstream, downstreamConfig, {
      runnerImage: config.runnerImage,
      retries: config.retries,
    });
    return { runId: randomUUID(), upstream: upstreamName, ref: job.headSha, comparisons };
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

async function claimJob(config: CoordinatorConfig): Promise<WorkerJob | null> {
  const response = await fetch(`${config.url}/internal/jobs/claim`, {
    method: "POST",
    headers: headers(config.token),
    body: JSON.stringify({ workerId: config.workerId, leaseSeconds: 900 }),
  });
  if (response.status === 204) return null;
  if (!response.ok) throw new Error(`claim failed (${response.status}): ${await response.text()}`);
  const payload = (await response.json()) as { job?: WorkerJob };
  if (!payload.job) throw new Error("coordinator returned no job");
  return payload.job;
}

async function completeJob(
  config: CoordinatorConfig,
  jobId: string,
  result: { runId: string; upstream: string; ref: string; comparisons: Comparison[] },
): Promise<void> {
  const response = await fetch(`${config.url}/internal/jobs/${encodeURIComponent(jobId)}/complete`, {
    method: "POST",
    headers: headers(config.token),
    body: JSON.stringify(result),
  });
  if (!response.ok) throw new Error(`completion failed (${response.status}): ${await response.text()}`);
}

async function failJob(config: CoordinatorConfig, jobId: string, error: string): Promise<void> {
  const response = await fetch(`${config.url}/internal/jobs/${encodeURIComponent(jobId)}/complete`, {
    method: "POST",
    headers: headers(config.token),
    body: JSON.stringify({ error }),
  });
  if (!response.ok) throw new Error(`failure report failed (${response.status}): ${await response.text()}`);
}

function coordinatorConfig(): CoordinatorConfig {
  const url = process.env.DOWNSTREAMCI_COORDINATOR_URL?.replace(/\/$/, "");
  const token = process.env.DOWNSTREAMCI_INTERNAL_TOKEN;
  if (!url || !token) throw new Error("DOWNSTREAMCI_COORDINATOR_URL and DOWNSTREAMCI_INTERNAL_TOKEN are required");
  return {
    url,
    token,
    workerId: process.env.DOWNSTREAMCI_WORKER_ID ?? `worker-${process.pid}`,
    pollMs: boundedInt(process.env.DOWNSTREAMCI_POLL_MS, 2_000, 250, 60_000),
    runnerImage: process.env.DOWNSTREAMCI_RUNNER_IMAGE ?? "downstreamci/runner:local",
    retries: boundedInt(process.env.DOWNSTREAMCI_RETRIES, 2, 1, 10),
  };
}

async function workerRoot(): Promise<string> {
  const configured = process.env.DOWNSTREAMCI_WORKSPACE_ROOT;
  if (!configured) throw new Error("DOWNSTREAMCI_WORKSPACE_ROOT is required for coordinator execution");
  await mkdir(resolve(configured), { recursive: true, mode: 0o700 });
  return realpath(resolve(configured));
}

function headers(token: string): Record<string, string> {
  return { "content-type": "application/json", authorization: `Bearer ${token}` };
}

function boundedInt(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isInteger(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return;
  await new Promise<void>((resolvePromise) => {
    const timer = setTimeout(resolvePromise, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      resolvePromise();
    }, { once: true });
  });
}
