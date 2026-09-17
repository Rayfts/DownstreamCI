import { describe, expect, it } from "vitest";
import { githubCheckOutput, sanitizeComparisonsForStorage, summarizeComparisons } from "../src/reporting.js";
import type { Comparison, Execution } from "../src/types.js";

function execution(exitCode: number, output = "", environment: Record<string, string> = {}): Execution {
  const test = { command: "test", exitCode, stdout: output, stderr: "", durationMs: 10, timedOut: false, kind: "test" as const };
  return { test, attempts: [test, test], environment };
}

describe("GitHub compatibility reporting", () => {
  it("renders deterministic matrix, runtime, clusters, linked artifacts, confidence, and analysis", () => {
    const comparison: Comparison = {
      downstream: { repository: "org/consumer", ref: "abc123", ecosystem: "npm" },
      classification: "newly-broken",
      confidence: 0.99,
      baseline: execution(0, "ok", { node: "24.1.0" }),
      candidate: execution(1, "TypeError: removed API", { node: "24.1.0" }),
      candidateSignature: "deadbeefdeadbeef",
      cluster: { id: "cluster-123", fingerprint: "deadbeefdeadbeef", label: "TypeError: removed API", members: 2 },
      artifacts: [
        {
          kind: "candidate-log",
          path: "run/consumer/candidate.log",
          url: "https://ci.example.test/api/artifacts/run/consumer/candidate.log",
          sha256: "a".repeat(64),
          bytes: 42,
        },
      ],
      analysis: { harness: "codex", label: "ANALYSIS", raw: "Likely upstream regression based on the supplied diff." },
      reason: "The downstream passes baseline and fails only with the candidate.",
    };
    const output = githubCheckOutput([comparison]);
    expect(output.text).toContain("Deterministic compatibility matrix");
    expect(output.text).toContain("99%");
    expect(output.text).toContain("cluster-123");
    expect(output.text).toContain("[candidate-log](https://ci.example.test/api/artifacts/run/consumer/candidate.log)");
    expect(output.text).toContain('"node": "24.1.0"');
    expect(output.text).toContain("ANALYSIS (codex)");
  });

  it("returns neutral when no downstream result exists", () => {
    const summary = summarizeComparisons([]);
    expect(summary.conclusion).toBe("neutral");
    expect(summary.title).toContain("No downstream results");
  });

  it("returns a neutral conclusion when coverage is incomplete without a regression", () => {
    const comparison: Comparison = {
      classification: "baseline-failing",
      baseline: execution(1, "old failure"),
      candidate: execution(1, "old failure"),
      reason: "pre-existing failure",
    };
    expect(summarizeComparisons([comparison]).conclusion).toBe("neutral");
  });

  it("redacts and bounds data before history persistence", () => {
    const token = "ghp_123456789012345678901234567890";
    const comparison: Comparison = {
      classification: "newly-broken",
      baseline: execution(0, "ok"),
      candidate: execution(1, `Authorization: Bearer ${token}`),
      analysis: { harness: "codex", label: "ANALYSIS", raw: `token=${token}` },
      cluster: { id: "cluster-a", fingerprint: "abc", label: `failure ${token}`, members: 1 },
      reason: "candidate-only",
    };
    const [stored] = sanitizeComparisonsForStorage([comparison]);
    const serialized = JSON.stringify(stored);
    expect(serialized).not.toContain(token);
    expect(serialized).toContain("<redacted-github-token>");
  });
});
