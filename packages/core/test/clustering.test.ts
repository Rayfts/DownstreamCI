import { describe, expect, it } from "vitest";
import { clusterComparisons } from "../src/clustering.js";
import type { Comparison, Execution } from "../src/types.js";

function execution(exitCode: number, stderr = ""): Execution {
  const test = {
    command: "test",
    exitCode,
    stdout: "",
    stderr,
    durationMs: 10,
    timedOut: false,
    kind: "test" as const,
  };
  return { test, attempts: [test, test], environment: {} };
}

function regression(repository: string, signature: string, stderr: string): Comparison {
  return {
    downstream: { repository, ref: "abc" },
    classification: "newly-broken",
    confidence: 0.99,
    baseline: execution(0),
    candidate: execution(1, stderr),
    candidateSignature: signature,
    reason: "candidate-only failure",
  };
}

describe("deterministic failure clustering", () => {
  it("groups exact normalized signatures with stable IDs", () => {
    const clustered = clusterComparisons([
      regression("org/a", "same-signature", "TypeError: missing field"),
      regression("org/b", "same-signature", "TypeError: missing field"),
    ]);
    expect(clustered[0]?.cluster?.id).toBe(clustered[1]?.cluster?.id);
    expect(clustered[0]?.cluster?.members).toBe(2);
    expect(clustered[0]?.cluster?.label).toContain("TypeError");
  });

  it("does not cluster non-regressions", () => {
    const comparison: Comparison = {
      classification: "baseline-failing",
      baseline: execution(1, "old failure"),
      candidate: execution(1, "old failure"),
      reason: "pre-existing",
    };
    expect(clusterComparisons([comparison])[0]?.cluster).toBeUndefined();
  });
});
