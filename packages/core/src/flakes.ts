import type { Comparison, DownstreamSpec } from "./types.js";

export function applyExpectedFlakePolicy(comparison: Comparison, spec: DownstreamSpec): Comparison {
  const patterns = spec.expectedFlakyTests?.filter(Boolean) ?? [];
  if (patterns.length === 0) return comparison;
  if (comparison.classification !== "newly-broken" && comparison.classification !== "flaky") return comparison;

  const candidateLog = `${comparison.candidate.test.stderr}\n${comparison.candidate.test.stdout}`;
  const match = patterns.find((pattern) => candidateLog.includes(pattern));
  if (!match) return comparison;

  return {
    ...comparison,
    classification: "flaky",
    confidence: comparison.classification === "flaky" ? comparison.confidence : Math.min(comparison.confidence ?? 0.75, 0.75),
    expectedFlakeMatch: match,
    reason:
      comparison.classification === "flaky"
        ? `${comparison.reason} The failure also matched maintainer-declared flaky evidence: ${match}`
        : `The candidate-only failure matched maintainer-declared flaky evidence: ${match}. It is reported as flaky rather than a regression.`,
  };
}
