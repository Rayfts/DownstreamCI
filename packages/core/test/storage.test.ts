import { describe, expect, it } from "vitest";
import { RunStore } from "../src/storage.js";
import type { Comparison, Execution } from "../src/types.js";

function execution(exitCode: number, output = ""): Execution {
  const test = {
    command: "test",
    exitCode,
    stdout: output,
    stderr: "",
    durationMs: 1,
    timedOut: false,
    kind: "test" as const,
  };
  return { test, attempts: [test], environment: { node: "24.0.0" } };
}

function comparison(classification: Comparison["classification"], repository: string): Comparison {
  return {
    downstream: { repository, ref: "abc", ecosystem: "npm" },
    classification,
    baseline: execution(classification === "baseline-failing" ? 1 : 0),
    candidate: execution(classification === "newly-broken" || classification === "baseline-failing" ? 1 : 0),
    reason: classification,
  };
}

describe("run history signals", () => {
  it("aggregates high-signal and flaky downstream history", () => {
    const store = new RunStore(":memory:");
    try {
      store.save("one", "upstream", "1", [comparison("unaffected", "org/stable"), comparison("flaky", "org/flaky")]);
      store.save("two", "upstream", "2", [comparison("newly-broken", "org/stable"), comparison("flaky", "org/flaky")]);
      const signals = store.signals();
      expect(signals.classifications["newly-broken"]).toBe(1);
      expect(signals.downstreams.find((item) => item.repository === "org/stable")?.runs).toBe(2);
      expect(signals.downstreams.find((item) => item.repository === "org/flaky")?.flaky).toBe(2);
      expect(signals.ecosystems.npm?.flaky).toBe(2);
      expect(signals.runtimes.node?.["24.0.0"]).toBe(4);
    } finally {
      store.close();
    }
  });

  it("never persists raw credential-shaped log or analysis values", () => {
    const store = new RunStore(":memory:");
    const token = "ghp_123456789012345678901234567890";
    try {
      const item = comparison("newly-broken", "org/private");
      item.candidate = execution(1, `leaked=${token}`);
      item.analysis = { harness: "codex", label: "ANALYSIS", raw: token };
      store.save("secret", "upstream", "sha", [item]);
      const serialized = JSON.stringify(store.get("secret"));
      expect(serialized).not.toContain(token);
      expect(serialized).toContain("<redacted-github-token>");
    } finally {
      store.close();
    }
  });
});
