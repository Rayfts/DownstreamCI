import { describe, expect, it } from "vitest";
import { buildAnalysisPrompt, buildSemanticClusterPrompt } from "../src/agent-analysis.js";
import type { Comparison, Execution } from "../src/types.js";

function execution(exitCode: number, output: string): Execution {
  const test = {
    command: "test",
    exitCode,
    stdout: output,
    stderr: "",
    durationMs: 1,
    timedOut: false,
    kind: "test" as const,
  };
  return { test, attempts: [test], environment: { node: "24" } };
}

describe("agent analysis prompts", () => {
  it("redacts credential-shaped values before a harness sees evidence", () => {
    const token = "ghp_123456789012345678901234567890";
    const prompt = buildAnalysisPrompt({
      upstreamDiff: `+ token=${token}`,
      candidateMetadata: { identity: "pkg" },
      baselineLog: "ok",
      candidateLog: `Authorization: Bearer ${token}`,
      dependencyManifest: "package.json",
      runtime: { node: "24" },
    });
    expect(prompt).not.toContain(token);
    expect(prompt).toContain("<redacted-github-token>");
  });

  it("keeps deterministic cluster IDs immutable while requesting optional semantic families", () => {
    const comparison: Comparison = {
      downstream: { repository: "org/consumer", ref: "abc" },
      classification: "newly-broken",
      confidence: 0.99,
      cluster: { id: "cluster-deadbeef", fingerprint: "deadbeef", label: "TypeError: removed API", members: 1 },
      baseline: execution(0, "ok"),
      candidate: execution(1, "TypeError: removed API"),
      reason: "candidate-only failure",
    };
    const prompt = buildSemanticClusterPrompt([comparison]);
    expect(prompt).toContain("cluster-deadbeef");
    expect(prompt).toContain("OPTIONAL semantic clustering");
    expect(prompt).toContain("Do not merge, remove, relabel, or override CI facts");
  });
});
