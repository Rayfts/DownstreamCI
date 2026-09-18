import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildAgentEnvironment, buildAnalysisPrompt, buildSemanticClusterPrompt } from "../src/agent-analysis.js";
import type { Comparison, Execution } from "../src/types.js";

const originalEnvironment = { ...process.env };
afterEach(() => {
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, originalEnvironment);
});

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

  it("passes model credentials but excludes GitHub and control-plane secrets", () => {
    process.env.OPENAI_API_KEY = "model-key";
    process.env.GITHUB_TOKEN = "github-secret";
    process.env.DOWNSTREAMCI_GITHUB_READ_TOKEN = "clone-secret";
    process.env.DOWNSTREAMCI_INTERNAL_TOKEN = "internal-secret";
    process.env.AWS_SECRET_ACCESS_KEY = "aws-secret";
    process.env.SAFE_AGENT_SETTING = "safe-value";
    process.env.DOWNSTREAMCI_AGENT_ENV_ALLOWLIST = "SAFE_AGENT_SETTING,GITHUB_TOKEN,AWS_SECRET_ACCESS_KEY";

    const root = "/tmp/downstreamci-analysis-test";
    const environment = buildAgentEnvironment(root);
    expect(environment.OPENAI_API_KEY).toBe("model-key");
    expect(environment.SAFE_AGENT_SETTING).toBe("safe-value");
    expect(environment.GITHUB_TOKEN).toBeUndefined();
    expect(environment.DOWNSTREAMCI_GITHUB_READ_TOKEN).toBeUndefined();
    expect(environment.DOWNSTREAMCI_INTERNAL_TOKEN).toBeUndefined();
    expect(environment.AWS_SECRET_ACCESS_KEY).toBeUndefined();
    expect(environment.HOME).toBe(join(root, "home"));
  });
});
