import { createHmac, createSign, timingSafeEqual } from "node:crypto";
import { resolve } from "node:path";
import { Octokit } from "@octokit/rest";
import { RunStore, githubCheckOutput, summarizeComparisons, type Comparison } from "@downstreamci/core";
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
  comparisons: Comparison[];
}

interface PullRequestWebhook {
  action?: string;
  installation?: { id?: number };
  repository?: { name?: string; owner?: { login?: string } };
  pull_request?: { number?: number; head?: { sha?: string } };
}

export function createServer() {
  const app = Fastify({ logger: true, bodyLimit: 2_000_000 });
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
    const store = new RunStore(resolve(process.env.DOWNSTREAMCI_DB ?? ".downstreamci/downstreamci.db"));
    try {
      const limit = Number.parseInt(request.query.limit ?? "20", 10);
      return { runs: store.latest(Number.isFinite(limit) ? limit : 20) };
    } finally {
      store.close();
    }
  });

  app.post<{ Body: JsonEnvelope<CheckRequest> }>("/internal/checks", async (request, reply) => {
    const body = request.body.value;
    const octokit = await installationClient(body.installationId);
    const output = githubCheckOutput(body.comparisons);
    const summary = summarizeComparisons(body.comparisons);
    await octokit.checks.create({
      owner: body.owner,
      repo: body.repo,
      name: "DownstreamCI / compatibility",
      head_sha: body.headSha,
      status: "completed",
      conclusion: summary.conclusion,
      output,
    });
    return reply.send({ ok: true, conclusion: summary.conclusion });
  });

  app.post<{ Body: JsonEnvelope<PullRequestWebhook> }>("/webhooks/github", async (request, reply) => {
    verifyWebhook(request.body.raw, request.headers["x-hub-signature-256"]);
    const event = request.headers["x-github-event"];
    const body = request.body.value;
    const acceptedActions = new Set(["opened", "reopened", "synchronize", "ready_for_review"]);
    if (event !== "pull_request" || !body.action || !acceptedActions.has(body.action)) {
      return reply.code(202).send({ accepted: false, reason: "event does not trigger compatibility execution" });
    }

    const owner = body.repository?.owner?.login;
    const repo = body.repository?.name;
    const headSha = body.pull_request?.head?.sha;
    const pullNumber = body.pull_request?.number;
    const installationId = body.installation?.id;
    if (!owner || !repo || !headSha || !pullNumber || !installationId) {
      return reply.code(400).send({ error: "incomplete pull_request webhook payload" });
    }

    return reply.code(202).send({
      accepted: true,
      trigger: { owner, repo, headSha, pullNumber, installationId },
      note: "A coordinator should enqueue this normalized trigger; GitHub credentials remain outside untrusted workers.",
    });
  });

  return app;
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
