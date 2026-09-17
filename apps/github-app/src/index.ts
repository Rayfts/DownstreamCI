import { createHmac, createSign, randomUUID, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { Octokit } from "@octokit/rest";
import {
  CoordinatorJobStore,
  PostgresRunStore,
  RunStore,
  clusterComparisons,
  githubCheckOutput,
  sanitizeLog,
  summarizeComparisons,
  writeRunArtifacts,
  type Comparison,
  type CoordinatorJob,
} from "@downstreamci/core";
import Fastify from "fastify";

interface JsonEnvelope<T> {
  raw: string;
  value: T;
}

interface CheckRequest {
  owner: string;
  repo: string;
  headSha: string;
  installationId?: number;
  runId?: string;
  upstream?: string;
  ref?: string;
  comparisons: Comparison[];
}

interface PullRequestWebhook {
  action?: string;
  installation?: { id?: number };
  repository?: { name?: string; owner?: { login?: string } };
  pull_request?: {
    number?: number;
    head?: { sha?: string; repo?: { full_name?: string } };
    base?: { sha?: string };
  };
}

interface WorkerLeaseRequest {
  workerId?: string;
  leaseSeconds?: number;
}

interface CompleteRequest {
  workerId?: string;
  runId?: string;
  upstream?: string;
  ref?: string;
  comparisons?: Comparison[];
  error?: string;
}

export interface ServerDependencies {
  getOctokit?: (installationId?: number) => Promise<Octokit>;
  databasePath?: string;
  artifactRoot?: string;
}

type AnyRunStore = RunStore | PostgresRunStore;

const ARTIFACT_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,159}$/;
const ARTIFACT_FILES = new Set(["baseline.log", "candidate.log", "comparison.json", "manifest.json"]);

export function createServer(dependencies: ServerDependencies = {}) {
  const app = Fastify({ logger: true, bodyLimit: 2_000_000 });
  const getOctokit = dependencies.getOctokit ?? installationClient;
  const databasePath = dependencies.databasePath ?? resolve(process.env.DOWNSTREAMCI_DB ?? ".downstreamci/downstreamci.db");
  const artifactRoot = dependencies.artifactRoot ?? resolve(process.env.DOWNSTREAMCI_ARTIFACT_ROOT ?? ".downstreamci/artifacts");

  app.addContentTypeParser("application/json", { parseAs: "buffer" }, (_request, body, done) => {
    try {
      const raw = body.toString("utf8");
      done(null, { raw, value: JSON.parse(raw) } satisfies JsonEnvelope<unknown>);
    } catch (error) {
      done(error as Error, undefined);
    }
  });

  app.get("/healthz", async () => ({ ok: true }));

  app.get<{ Querystring: { limit?: string } }>("/api/runs/latest", async (request) => {
    const limit = parseLimit(request.query.limit, 20);
    return { runs: await withRunStore(databasePath, (store) => store.latest(limit)) };
  });

  app.get<{ Querystring: { limit?: string } }>("/api/signals", async (request) => {
    const limit = parseLimit(request.query.limit, 100);
    return { signals: await withRunStore(databasePath, (store) => store.signals(limit)) };
  });

  if (process.env.DOWNSTREAMCI_SERVE_ARTIFACTS === "1") {
    app.get<{ Params: { runId: string; bundle: string; file: string } }>(
      "/api/artifacts/:runId/:bundle/:file",
      async (request, reply) => {
        const { runId, bundle, file } = request.params;
        if (!ARTIFACT_SEGMENT.test(runId) || !ARTIFACT_SEGMENT.test(bundle) || !ARTIFACT_FILES.has(file)) {
          return reply.code(404).send({ error: "artifact not found" });
        }
        const path = resolve(artifactRoot, runId, bundle, file);
        const rel = relative(artifactRoot, path);
        if (rel.startsWith("..") || isAbsolute(rel)) return reply.code(404).send({ error: "artifact not found" });
        try {
          const content = await readFile(path);
          reply.type(file.endsWith(".json") ? "application/json; charset=utf-8" : "text/plain; charset=utf-8");
          return reply.send(content);
        } catch {
          return reply.code(404).send({ error: "artifact not found" });
        }
      },
    );
  }

  app.post<{ Body: JsonEnvelope<WorkerLeaseRequest> }>("/internal/jobs/claim", async (request, reply) => {
    if (!validInternalToken(request.headers.authorization)) return reply.code(401).send({ error: "unauthorized" });
    const workerId = request.body.value.workerId?.trim();
    if (!workerId) return reply.code(400).send({ error: "workerId is required" });
    const store = new CoordinatorJobStore(databasePath);
    try {
      const job = store.claim(workerId, request.body.value.leaseSeconds ?? 900);
      if (!job) return reply.code(204).send();
      return reply.send({ job: workerJob(job) });
    } finally {
      store.close();
    }
  });

  app.post<{ Params: { id: string }; Body: JsonEnvelope<WorkerLeaseRequest> }>(
    "/internal/jobs/:id/lease",
    async (request, reply) => {
      if (!validInternalToken(request.headers.authorization)) return reply.code(401).send({ error: "unauthorized" });
      const workerId = request.body.value.workerId?.trim();
      if (!workerId) return reply.code(400).send({ error: "workerId is required" });
      const jobs = new CoordinatorJobStore(databasePath);
      try {
        if (!jobs.get(request.params.id)) return reply.code(404).send({ error: "unknown job" });
        const renewed = jobs.renew(request.params.id, workerId, request.body.value.leaseSeconds ?? 900);
        if (!renewed) return reply.code(409).send({ error: "job lease is expired or owned by another worker" });
        return reply.send({ job: workerJob(renewed) });
      } finally {
        jobs.close();
      }
    },
  );

  app.post<{ Params: { id: string }; Body: JsonEnvelope<CompleteRequest> }>(
    "/internal/jobs/:id/complete",
    async (request, reply) => {
      if (!validInternalToken(request.headers.authorization)) return reply.code(401).send({ error: "unauthorized" });
      const body = request.body.value;
      const workerId = body.workerId?.trim();
      if (!workerId) return reply.code(400).send({ error: "workerId is required" });

      const jobs = new CoordinatorJobStore(databasePath);
      try {
        const existing = jobs.get(request.params.id);
        if (!existing) return reply.code(404).send({ error: "unknown job" });
        if (!jobs.renew(existing.id, workerId, 900)) {
          return reply.code(409).send({ error: "job lease is expired or owned by another worker" });
        }
        const job = jobs.get(existing.id);
        if (!job) return reply.code(404).send({ error: "unknown job" });

        const octokit = await getOctokit(job.installationId);
        if (body.error) {
          await octokit.checks.update({
            owner: job.owner,
            repo: job.repo,
            check_run_id: job.checkRunId,
            status: "completed",
            conclusion: "neutral",
            output: {
              title: "DownstreamCI execution could not complete",
              summary: sanitizeCoordinatorMessage(body.error),
            },
          });
          if (!jobs.finishClaimed(job.id, workerId, "failed")) {
            throw new Error(`Unable to finish claimed job ${job.id}`);
          }
          return reply.send({ ok: false, status: "failed" });
        }

        if (!body.comparisons || !body.runId || !body.upstream || !body.ref) {
          return reply.code(400).send({ error: "runId, upstream, ref, and comparisons are required" });
        }
        let comparisons = clusterComparisons(body.comparisons);
        comparisons = await prepareArtifacts(artifactRoot, body.runId, comparisons);
        const summary = summarizeComparisons(comparisons);
        await octokit.checks.update({
          owner: job.owner,
          repo: job.repo,
          check_run_id: job.checkRunId,
          status: "completed",
          conclusion: summary.conclusion,
          output: githubCheckOutput(comparisons),
        });
        await withRunStore(databasePath, (store) => store.save(body.runId as string, body.upstream as string, body.ref as string, comparisons));
        if (!jobs.finishClaimed(job.id, workerId, "completed")) {
          throw new Error(`Unable to finish claimed job ${job.id}`);
        }
        return reply.send({ ok: true, conclusion: summary.conclusion });
      } finally {
        jobs.close();
      }
    },
  );

  app.post<{ Body: JsonEnvelope<CheckRequest> }>("/internal/checks", async (request, reply) => {
    if (!validInternalToken(request.headers.authorization)) return reply.code(401).send({ error: "unauthorized" });
    const body = request.body.value;
    const octokit = await getOctokit(body.installationId);
    let comparisons = clusterComparisons(body.comparisons);
    if (body.runId) comparisons = await prepareArtifacts(artifactRoot, body.runId, comparisons);
    const output = githubCheckOutput(comparisons);
    const summary = summarizeComparisons(comparisons);
    await octokit.checks.create({
      owner: body.owner,
      repo: body.repo,
      name: "DownstreamCI / compatibility",
      head_sha: body.headSha,
      status: "completed",
      conclusion: summary.conclusion,
      output,
    });
    if (body.runId && body.upstream && body.ref) {
      await withRunStore(databasePath, (store) => store.save(body.runId as string, body.upstream as string, body.ref as string, comparisons));
    }
    return reply.send({ ok: true, conclusion: summary.conclusion });
  });

  app.post<{ Body: JsonEnvelope<PullRequestWebhook> }>("/webhooks/github", async (request, reply) => {
    try {
      verifyWebhook(request.body.raw, request.headers["x-hub-signature-256"]);
    } catch {
      return reply.code(401).send({ error: "invalid webhook signature" });
    }
    const event = request.headers["x-github-event"];
    const body = request.body.value;
    const acceptedActions = new Set(["opened", "reopened", "synchronize", "ready_for_review"]);
    if (event !== "pull_request" || !body.action || !acceptedActions.has(body.action)) {
      return reply.code(202).send({ accepted: false, reason: "event does not trigger compatibility execution" });
    }

    const owner = body.repository?.owner?.login;
    const repo = body.repository?.name;
    const headRepository = body.pull_request?.head?.repo?.full_name;
    const headSha = body.pull_request?.head?.sha;
    const baseSha = body.pull_request?.base?.sha;
    const pullNumber = body.pull_request?.number;
    const installationId = body.installation?.id;
    if (!owner || !repo || !headRepository || !headSha || !baseSha || !pullNumber || !installationId) {
      return reply.code(400).send({ error: "incomplete pull_request webhook payload" });
    }

    const octokit = await getOctokit(installationId);
    const check = await octokit.checks.create({
      owner,
      repo,
      name: "DownstreamCI / compatibility",
      head_sha: headSha,
      status: "queued",
      output: {
        title: "Queued for downstream compatibility testing",
        summary: `Pull request #${pullNumber} will use the trusted base configuration at ${baseSha.slice(0, 12)}.`,
      },
    });
    const jobs = new CoordinatorJobStore(databasePath);
    try {
      const job = jobs.enqueue({
        id: randomUUID(),
        owner,
        repo,
        headRepository,
        headSha,
        baseSha,
        pullNumber,
        installationId,
        checkRunId: check.data.id,
      });
      return reply.code(202).send({ accepted: true, job: workerJob(job) });
    } finally {
      jobs.close();
    }
  });

  return app;
}

function createRunStore(databasePath: string): AnyRunStore {
  const databaseUrl = process.env.DOWNSTREAMCI_DATABASE_URL ?? process.env.DATABASE_URL;
  if (databaseUrl) return new PostgresRunStore(databaseUrl);
  return new RunStore(databasePath);
}

async function withRunStore<T>(databasePath: string, work: (store: AnyRunStore) => T | Promise<T>): Promise<T> {
  const store = createRunStore(databasePath);
  try {
    return await work(store);
  } finally {
    await store.close();
  }
}

async function prepareArtifacts(root: string, runId: string, comparisons: Comparison[]): Promise<Comparison[]> {
  const written = await writeRunArtifacts(root, runId, comparisons);
  const publicUrl = process.env.DOWNSTREAMCI_PUBLIC_URL?.replace(/\/$/, "");
  if (process.env.DOWNSTREAMCI_SERVE_ARTIFACTS !== "1" || !publicUrl) return written;
  return written.map((comparison) => ({
    ...comparison,
    ...(comparison.artifacts
      ? {
          artifacts: comparison.artifacts.map((artifact) => ({
            ...artifact,
            url: `${publicUrl}/api/artifacts/${artifact.path
              .split(/[\\/]/)
              .map((segment) => encodeURIComponent(segment))
              .join("/")}`,
          })),
        }
      : {}),
  }));
}

function workerJob(job: CoordinatorJob) {
  return {
    id: job.id,
    owner: job.owner,
    repo: job.repo,
    ...(job.headRepository ? { headRepository: job.headRepository } : {}),
    headSha: job.headSha,
    ...(job.baseSha ? { baseSha: job.baseSha } : {}),
    pullNumber: job.pullNumber,
    status: job.status,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    ...(job.leaseUntil === undefined ? {} : { leaseUntil: job.leaseUntil }),
  };
}

function validInternalToken(authorization: string | undefined): boolean {
  const expected = process.env.DOWNSTREAMCI_INTERNAL_TOKEN;
  if (!expected || !authorization?.startsWith("Bearer ")) return false;
  const provided = authorization.slice("Bearer ".length);
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  return a.length === b.length && timingSafeEqual(a, b);
}

function sanitizeCoordinatorMessage(value: string): string {
  return sanitizeLog(value.replace(/[\r\n]+/g, " "), 4_000);
}

function parseLimit(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? String(fallback), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(100, parsed));
}

async function installationClient(installationId?: number): Promise<Octokit> {
  const token = process.env.GITHUB_TOKEN;
  if (token) return new Octokit({ auth: token });

  const appId = process.env.GITHUB_APP_ID;
  const privateKey = process.env.GITHUB_APP_PRIVATE_KEY?.replaceAll("\\n", "\n");
  if (!appId || !privateKey || !installationId) {
    throw new Error("Configure GITHUB_TOKEN or GITHUB_APP_ID + GITHUB_APP_PRIVATE_KEY + installationId");
  }

  const appClient = new Octokit({ auth: createAppJwt(appId, privateKey) });
  const response = await appClient.apps.createInstallationAccessToken({ installation_id: installationId });
  return new Octokit({ auth: response.data.token });
}

function createAppJwt(appId: string, privateKey: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64url(JSON.stringify({ iat: now - 60, exp: now + 540, iss: appId }));
  const unsigned = `${header}.${payload}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  const signature = signer.sign(privateKey);
  return `${unsigned}.${base64url(signature)}`;
}

function base64url(value: string | Buffer): string {
  return Buffer.from(value).toString("base64url");
}

function verifyWebhook(raw: string, provided: string | string[] | undefined): void {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) throw new Error("GITHUB_WEBHOOK_SECRET is not configured");
  if (typeof provided !== "string" || !provided.startsWith("sha256=")) throw new Error("Missing webhook signature");
  const expected = `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`;
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new Error("Invalid webhook signature");
}

if (process.env.DOWNSTREAMCI_STANDALONE === "1") {
  const app = createServer();
  await app.listen({ port: Number(process.env.PORT ?? 8787), host: "0.0.0.0" });
}
