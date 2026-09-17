import { describe, expect, it } from "vitest";
import { compareExecutions } from "../src/compare.js";
import { applyExpectedFlakePolicy } from "../src/flakes.js";
import type { CommandResult, DownstreamSpec, Execution } from "../src/types.js";

function result(exitCode: number, stderr = ""): CommandResult {
  return { command: "test", exitCode, stdout: "", stderr, durationMs: 1, timedOut: false, kind: "test" };
}

function execution(...results: CommandResult[]): Execution {
  const test = results.at(-1);
  if (!test) throw new Error("result required");
  return { test, attempts: results, environment: {} };
}

const spec: DownstreamSpec = {
  repository: "org/project",
  ref: "abc",
  ecosystem: "npm",
  test: "npm test",
  expectedFlakyTests: ["ECONNRESET in integration fixture"],
};

describe("expected flaky evidence", () => {
  it("downgrades only an explicitly matching candidate-only failure", () => {
    const comparison = compareExecutions(
      execution(result(0), result(0)),
      execution(result(1, "ECONNRESET in integration fixture"), result(1, "ECONNRESET in integration fixture")),
    );
    const classified = applyExpectedFlakePolicy(comparison, spec);
    expect(classified.classification).toBe("flaky");
    expect(classified.expectedFlakeMatch).toBe("ECONNRESET in integration fixture");
  });

  it("keeps an undeclared candidate failure as newly broken", () => {
    const comparison = compareExecutions(execution(result(0)), execution(result(1, "TypeError: removed API")));
    expect(applyExpectedFlakePolicy(comparison, spec).classification).toBe("newly-broken");
  });
});
