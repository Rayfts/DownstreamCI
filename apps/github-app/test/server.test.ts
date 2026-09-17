import { createHmac } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Octokit } from "@octokit/rest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer } from "../src/index.js";

const cleanup: string[] = [];
const originalWebhookSecret = process.env.GITHUB_WEBHOOK_SECRET;
const originalInternalToken = process.env.DOWNSTREAMCI_INTERNAL_TOKEN;

afterEach(async () => {
  process.env.GITHUB_WEBHOOK_SECRET = originalWebhookSecret;
  process.env.DOWNSTREAMCI_INTERNAL_TOKEN = originalInternalToken;
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("GitHub coordinator", () => {
  it("verifies webhooks, persists a job, and exposes it only to authenticated workers", async () => {
    process.env.GITHUB_WEBHOOK_SECRET = "webhook-secret";
    process.env.DOWNSTREAMCI_INTERNAL_TOKEN = "internal-secret";
    const directory = await mkdtemp(join(tmpdir(), "downstreamci-github-app-"));
    cleanup.push(directory);
    const checks = {
      create: vi.fn().mockResolvedValue({ data: { id: 9001 } }),
      update: vi.fn().mockResolvedValue({ data: {} }),
    };
    const app = createServer({
      databasePath: join(directory, "coordinator.db"),
      getOctokit: async () => ({ checks } as unknown as Octokit),
    });
    const payload = JSON.stringify({
      action: "opened",
      installation: { id: 12 },
      repository: { name: "library", owner: { login: "org" } },
      pull_request: { number: 7, head: { sha: "abc123" } },
    });
    const signature = `sha256=${createHmac("sha256", "webhook-secret").update(payload).digest("hex")}`;

    const webhook = await app.inject({
      method: "POST",
      url: "/webhooks/github",
      headers: { "content-type": "application/json", "x-github-event": "pull_request", "x-hub-signature-256": signature },
      payload,
    });
    expect(webhook.statusCode).toBe(202);
    expect(checks.create).toHaveBeenCalledOnce();

    const unauthorized = await app.inject({
      method: "POST",
      url: "/internal/jobs/claim",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ workerId: "worker-1" }),
    });
    expect(unauthorized.statusCode).toBe(401);

    const claimed = await app.inject({
      method: "POST",
      url: "/internal/jobs/claim",
      headers: { "content-type": "application/json", authorization: "Bearer internal-secret" },
      payload: JSON.stringify({ workerId: "worker-1" }),
    });
    expect(claimed.statusCode).toBe(200);
    const body = claimed.json() as { job: { id: string; owner: string; repo: string; headSha: string } };
    expect(body.job.owner).toBe("org");
    expect(body.job.repo).toBe("library");
    expect(body.job.headSha).toBe("abc123");

    const completed = await app.inject({
      method: "POST",
      url: `/internal/jobs/${body.job.id}/complete`,
      headers: { "content-type": "application/json", authorization: "Bearer internal-secret" },
      payload: JSON.stringify({
        runId: "run-1",
        upstream: "org/library",
        ref: "abc123",
        comparisons: [],
      }),
    });
    expect(completed.statusCode).toBe(200);
    expect(checks.update).toHaveBeenCalledOnce();
    await app.close();
  });

  it("rejects an invalid webhook signature", async () => {
    process.env.GITHUB_WEBHOOK_SECRET = "webhook-secret";
    const app = createServer({ getOctokit: async () => ({ checks: {} } as unknown as Octokit) });
    const response = await app.inject({
      method: "POST",
      url: "/webhooks/github",
      headers: { "content-type": "application/json", "x-github-event": "pull_request", "x-hub-signature-256": "sha256=bad" },
      payload: JSON.stringify({ action: "opened" }),
    });
    expect(response.statusCode).toBe(500);
    await app.close();
  });
});
