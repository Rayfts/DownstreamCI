import { failureSignature } from "./signatures.js";
import type { CommandResult, Comparison, Execution } from "./types.js";

function passed(result: CommandResult): boolean {
  return result.exitCode === 0 && !result.timedOut;
}

function infra(execution: Execution): boolean {
  return execution.test.kind === "infrastructure" || execution.test.timedOut;
}

function setupFailed(execution: Execution): boolean {
  return execution.setup !== undefined && execution.setup.exitCode !== 0;
}

function observedBothPassAndFail(execution: Execution): boolean {
  if (execution.attempts.length < 2) return false;
  return new Set(execution.attempts.map((attempt) => passed(attempt))).size > 1;
}

export function compareExecutions(baseline: Execution, candidate: Execution): Comparison {
  const baselineText = `${baseline.test.stderr}\n${baseline.test.stdout}`;
  const candidateText = `${candidate.test.stderr}\n${candidate.test.stdout}`;
  const baselineSignature = passed(baseline.test) ? undefined : failureSignature(baselineText);
  const candidateSignature = passed(candidate.test) ? undefined : failureSignature(candidateText);
  const withSignatures = {
    ...(baselineSignature ? { baselineSignature } : {}),
    ...(candidateSignature ? { candidateSignature } : {}),
  };

  if (setupFailed(baseline) || setupFailed(candidate)) {
    return { classification: "setup-failure", baseline, candidate, ...withSignatures, reason: "Setup failed before a trustworthy comparison could be made." };
  }
  if (infra(baseline) || infra(candidate)) {
    return { classification: "infrastructure-failure", baseline, candidate, ...withSignatures, reason: "A timeout or infrastructure failure prevented a trustworthy comparison." };
  }
  if (observedBothPassAndFail(baseline) || observedBothPassAndFail(candidate)) {
    return { classification: "flaky", baseline, candidate, ...withSignatures, reason: "Repeated attempts produced both passing and failing outcomes." };
  }

  const basePass = passed(baseline.test);
  const candPass = passed(candidate.test);
  if (basePass && candPass) return { classification: "unaffected", baseline, candidate, reason: "The downstream passes both baseline and candidate." };
  if (basePass && !candPass) return { classification: "newly-broken", baseline, candidate, ...withSignatures, reason: "The downstream passes baseline and fails only with the candidate." };
  if (!basePass && candPass) return { classification: "improved", baseline, candidate, ...withSignatures, reason: "The downstream fails baseline and passes with the candidate." };

  return {
    classification: "baseline-failing",
    baseline,
    candidate,
    ...withSignatures,
    reason: baselineSignature === candidateSignature
      ? "The downstream already fails at baseline with the same normalized signature."
      : "The downstream already fails at baseline; candidate failure is not promoted to a regression.",
  };
}
