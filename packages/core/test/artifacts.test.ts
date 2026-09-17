import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { writeRunArtifacts } from "../src/artifacts.js";
import type { Comparison, Execution } from "../src/types.js";

const cleanup: string[] = [];
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

function execution(exitCode: number, output: string): Execution {
  const test = {
    command: "test",
    exitCode,
    stdout: output,
    stderr: "",
    durationMs: 5,
    timedOut: false,
    kind: "test" as const,
  };
  return { test, attempts: [test], environment: { node: "24.0.0" } };
}

describe("local evidence artifacts", () => {
  it("writes sanitized checksummed logs and comparison JSON", async () => {
    const root = await mkdtemp(join(tmpdir(), "downstreamci-artifacts-"));
    cleanup.push(root);
    const comparison: Comparison = {
      downstream: { repository: "org/project", ref: "abc" },
      classification: "newly-broken",
      confidence: 0.9,
      baseline: execution(0, "ok"),
      candidate: execution(1, "Authorization: Bearer super-secret-token-value"),
      reason: "candidate-only",
    };
    const [result] = await writeRunArtifacts(root, "run-1", [comparison]);
    expect(result?.artifacts).toHaveLength(3);
    for (const artifact of result?.artifacts ?? []) {
      expect(artifact.sha256).toHaveLength(64);
      await access(join(root, artifact.path));
    }
    const candidate = result?.artifacts?.find((artifact) => artifact.kind === "candidate-log");
    expect(candidate).toBeDefined();
    expect(await readFile(join(root, candidate?.path ?? ""), "utf8")).not.toContain("super-secret-token-value");
  });
});
