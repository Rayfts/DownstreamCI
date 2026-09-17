import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { confinedWorkspace } from "../src/index.js";

const cleanup: string[] = [];
const originalRoot = process.env.DOWNSTREAMCI_WORKSPACE_ROOT;
afterEach(async () => {
  process.env.DOWNSTREAMCI_WORKSPACE_ROOT = originalRoot;
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
