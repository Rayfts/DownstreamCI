import { describe, expect, it } from "vitest";
import { compareExecutions } from "../src/compare.js";
import type { CommandResult, Execution } from "../src/types.js";

function result(exitCode: number, stderr = ""): CommandResult {
  return { command: "test", exitCode, stdout: "", stderr, durationMs: 1, timedOut: false, kind: "test" };
}

function execution(...results: CommandResult[]): Execution {
  const test = results.at(-1);
  if (!test) throw new Error("result required");
  return { test, attempts: results, environment: {} };
}

describe("compareExecutions", () => {
  it("detects candidate-only failures", () => {
    expect(compareExecutions(execution(result(0)), execution(result(1, "TypeError: removed API"))).classification).toBe("newly-broken");
  });

  it("never promotes a pre-existing failure to regression", () => {
    const comparison = compareExecutions(execution(result(1, "old failure")), execution(result(1, "different failure")));
    expect(comparison.classification).toBe("baseline-failing");
  });

  it("detects improvements", () => {
    expect(compareExecutions(execution(result(1, "old failure")), execution(result(0))).classification).toBe("improved");
  });

  it("detects flaky attempts before regression classification", () => {
    expect(compareExecutions(execution(result(0)), execution(result(1, "x"), result(0))).classification).toBe("flaky");
  });

  it("classifies timeout as infrastructure failure", () => {
    const timeout = { ...result(1, "timeout"), timedOut: true };
    expect(compareExecutions(execution(result(0)), execution(timeout)).classification).toBe("infrastructure-failure");
  });
});
