import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { confinedWorkspace, createWorkerServer, validBearerToken } from "../src/index.js";

const cleanup: string[] = [];
const originalRoot = process.env.DOWNSTREAMCI_WORKSPACE_ROOT;
const originalWorkerToken = process.env.DOWNSTREAMCI_WORKER_TOKEN;
afterEach(async () => {
  process.env.DOWNSTREAMCI_WORKSPACE_ROOT = originalRoot;
  process.env.DOWNSTREAMCI_WORKER_TOKEN = originalWorkerToken;
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("worker workspace confinement", () => {
  it("allows paths inside the configured root and rejects paths outside it", async () => {
    const parent = await mkdtemp(join(tmpdir(), "downstreamci-worker-"));
    cleanup.push(parent);
    const root = join(parent, "root");
    const inside = join(root, "inside");
    const outside = join(parent, "outside");
    await mkdir(inside, { recursive: true });
    await mkdir(outside, { recursive: true });
    process.env.DOWNSTREAMCI_WORKSPACE_ROOT = root;
    await expect(confinedWorkspace(inside)).resolves.toBe(inside);
    await expect(confinedWorkspace(outside)).rejects.toThrow("outside DOWNSTREAMCI_WORKSPACE_ROOT");
  });
});

describe("worker execution API authentication", () => {
  it("uses constant-time bearer-token comparison semantics", () => {
    expect(validBearerToken("Bearer worker-secret", "worker-secret")).toBe(true);
    expect(validBearerToken("Bearer wrong", "worker-secret")).toBe(false);
    expect(validBearerToken(undefined, "worker-secret")).toBe(false);
  });

  it("fails closed when the worker API token is not configured", async () => {
    delete process.env.DOWNSTREAMCI_WORKER_TOKEN;
    const app = createWorkerServer();
    const response = await app.inject({
      method: "POST",
      url: "/v1/execute",
      payload: { image: "example", workspace: ".", command: "true" },
    });
    expect(response.statusCode).toBe(503);
    await app.close();
  });

  it("rejects unauthenticated execution before touching the workspace or Docker", async () => {
    process.env.DOWNSTREAMCI_WORKER_TOKEN = "worker-secret";
    const app = createWorkerServer();
    const response = await app.inject({
      method: "POST",
      url: "/v1/execute",
      headers: { authorization: "Bearer wrong" },
      payload: { image: "example", workspace: "/definitely/not/read", command: "true" },
    });
    expect(response.statusCode).toBe(401);
    await app.close();
  });
});
