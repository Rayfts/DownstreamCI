import type { CommandResult, Comparison, Execution } from "./types.js";

export interface CompatibilitySummary {
  total: number;
  counts: Record<string, number>;
  conclusion: "success" | "failure" | "neutral";
  title: string;
  summary: string;
}

export function summarizeComparisons(comparisons: Comparison[]): CompatibilitySummary {
  const counts: Record<string, number> = {};
  for (const result of comparisons) counts[result.classification] = (counts[result.classification] ?? 0) + 1;
  if (comparisons.length === 0) {
    return {
      total: 0,
      counts,
      conclusion: "neutral",
      title: "No downstream results were produced",
      summary: "0 downstreams",
    };
  }
  const regressions = counts["newly-broken"] ?? 0;
  const coverageGaps =
    (counts["baseline-failing"] ?? 0) +
    (counts.flaky ?? 0) +
    (counts["infrastructure-failure"] ?? 0) +
    (counts["setup-failure"] ?? 0) +
    (counts.inconclusive ?? 0);
  const summary = Object.entries(counts)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${value} ${key}`)
    .join(" · ");
  return {
    total: comparisons.length,
    counts,
    conclusion: regressions > 0 ? "failure" : coverageGaps > 0 ? "neutral" : "success",
    title:
      regressions > 0
        ? `${regressions} downstream regression${regressions === 1 ? "" : "s"} detected`
        : coverageGaps > 0
          ? `No candidate-only regressions; ${coverageGaps} result${coverageGaps === 1 ? "" : "s"} need attention`
          : "No candidate-only regressions detected",
    summary,
  };
}

export function githubCheckOutput(comparisons: Comparison[]): { title: string; summary: string; text: string } {
  const summary = summarizeComparisons(comparisons);
  const countLines = Object.entries(summary.counts)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([classification, count]) => `- **${classification}:** ${count}`);
  const matrix = [
    "## Deterministic compatibility matrix",
    "",
    "| Downstream | Baseline | Candidate | Classification | Confidence | Cluster |",
    "|---|---:|---:|---|---:|---|",
    ...comparisons.map((item) => {
      const name = item.downstream?.repository ?? "downstream";
      const confidence = item.confidence === undefined ? "—" : `${Math.round(item.confidence * 100)}%`;
      const cluster = item.cluster?.id ?? "—";
      return `| ${markdownCell(name)} | ${outcome(item.baseline)} | ${outcome(item.candidate)} | \`${item.classification}\` | ${confidence} | ${markdownCell(cluster)} |`;
    }),
  ].join("\n");
  const evidence = comparisons
    .filter((item) => item.classification !== "unaffected")
    .sort((a, b) => priority(a) - priority(b))
    .map(renderEvidence)
    .join("\n\n");
  const text = [
    matrix,
    "",
    "## Counts",
    ...(countLines.length ? countLines : ["- No downstream results were produced."]),
    evidence
      ? `\n## Evidence\n\n${evidence}`
      : comparisons.length
        ? "\nAll approved downstream comparisons were unaffected."
        : "\nNo usable downstream comparisons were produced; the Check is neutral.",
  ].join("\n");
  return {
    title: summary.title.slice(0, 255),
    summary: [`**Total downstreams:** ${summary.total}`, summary.summary].join("\n\n").slice(0, 65_535),
    text: text.slice(0, 60_000),
  };
}

export function sanitizeLog(value: string, maxChars = 8_000): string {
  const ansiPattern = new RegExp("\\u001B\\[[0-?]*[ -/]*[@-~]", "g");
  const withoutAnsi = value.replace(ansiPattern, "");
  const redacted = withoutAnsi
    .replace(/\b(gh[pousr]_[A-Za-z0-9_]{20,})\b/g, "<redacted-github-token>")
    .replace(/\b(sk-[A-Za-z0-9_-]{20,})\b/g, "<redacted-api-key>")
    .replace(/\b(AWS_SECRET_ACCESS_KEY\s*[=:]\s*)\S+/gi, "$1<redacted>")
    .replace(/\b(Authorization:\s*Bearer\s+)\S+/gi, "$1<redacted>");
  return redacted.slice(-maxChars);
}

export function sanitizeComparisonsForStorage(comparisons: Comparison[]): Comparison[] {
  return comparisons.map((comparison) => ({
    ...comparison,
    baseline: sanitizeExecution(comparison.baseline),
    candidate: sanitizeExecution(comparison.candidate),
    ...(comparison.analysis
      ? { analysis: { ...comparison.analysis, raw: sanitizeLog(comparison.analysis.raw, 16_000) } }
      : {}),
    ...(comparison.cluster
      ? { cluster: { ...comparison.cluster, label: sanitizeLog(comparison.cluster.label, 1_000) } }
      : {}),
  }));
}

function sanitizeExecution(execution: Execution): Execution {
  return {
    ...(execution.setup ? { setup: sanitizeCommandResult(execution.setup) } : {}),
    test: sanitizeCommandResult(execution.test),
    attempts: execution.attempts.map(sanitizeCommandResult),
    environment: { ...execution.environment },
  };
}

function sanitizeCommandResult(result: CommandResult): CommandResult {
  return {
    ...result,
    stdout: sanitizeLog(result.stdout, 20_000),
    stderr: sanitizeLog(result.stderr, 20_000),
  };
}

function renderEvidence(item: Comparison, index: number): string {
  const name = item.downstream?.repository ?? `downstream-${index + 1}`;
  const artifacts = item.artifacts?.length
    ? ["**Artifacts**", ...item.artifacts.map(renderArtifactReference)].join("\n")
    : "";
  const runtime = Object.keys(item.candidate.environment).length
    ? [
        "<details><summary>Runtime environment</summary>",
        "",
        "```json",
        sanitizeLog(JSON.stringify(item.candidate.environment, null, 2), 4_000),
        "```",
        "</details>",
      ].join("\n")
    : "";
  return [
    `### ${markdownCell(name)} — \`${item.classification}\``,
    item.downstream ? `Downstream ref: \`${item.downstream.ref}\`` : "",
    item.confidence === undefined ? "" : `Confidence: ${Math.round(item.confidence * 100)}%`,
    item.reason,
    item.expectedFlakeMatch ? `Expected-flake match: \`${markdownCell(item.expectedFlakeMatch)}\`` : "",
    item.baselineSignature ? `Baseline signature: \`${item.baselineSignature}\`` : "",
    item.candidateSignature ? `Candidate signature: \`${item.candidateSignature}\`` : "",
    item.cluster
      ? `Cluster: \`${item.cluster.id}\` (${item.cluster.members} member${item.cluster.members === 1 ? "" : "s"}) — ${markdownCell(item.cluster.label)}`
      : "",
    artifacts,
    item.analysis ? `**ANALYSIS (${item.analysis.harness})**\n\n${sanitizeLog(item.analysis.raw, 4_000)}` : "",
    runtime,
    "<details><summary>Baseline log excerpt</summary>",
    "",
    "```text",
    sanitizeLog(`${item.baseline.test.stderr}\n${item.baseline.test.stdout}`, 5_000),
    "```",
    "</details>",
    "<details><summary>Candidate log excerpt</summary>",
    "",
    "```text",
    sanitizeLog(`${item.candidate.test.stderr}\n${item.candidate.test.stdout}`, 7_000),
    "```",
    "</details>",
  ]
    .filter(Boolean)
    .join("\n");
}

function renderArtifactReference(artifact: NonNullable<Comparison["artifacts"]>[number]): string {
  const integrity = `${artifact.bytes} bytes, sha256 \`${artifact.sha256}\``;
  if (artifact.url && /^https?:\/\//.test(artifact.url)) {
    return `- [${artifact.kind}](${artifact.url}) — ${integrity}`;
  }
  return `- \`${artifact.kind}\`: \`${artifact.path}\` (${integrity})`;
}

function outcome(execution: Comparison["baseline"]): string {
  if (execution.test.kind === "infrastructure") return "infrastructure";
  if (execution.test.timedOut) return "timeout";
  return execution.test.exitCode === 0 ? "pass" : `fail (${execution.test.exitCode ?? "null"})`;
}

function priority(comparison: Comparison): number {
  if (comparison.classification === "newly-broken") return 0;
  if (comparison.classification === "infrastructure-failure" || comparison.classification === "setup-failure") return 1;
  if (comparison.classification === "flaky" || comparison.classification === "inconclusive") return 2;
  return 3;
}

function markdownCell(value: string): string {
  return value.replaceAll("|", "\\|").replace(/[\r\n]+/g, " ").slice(0, 240);
}
