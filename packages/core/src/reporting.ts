import type { Comparison } from "./types.js";

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
  const regressions = counts["newly-broken"] ?? 0;
  const infrastructure = (counts["infrastructure-failure"] ?? 0) + (counts["setup-failure"] ?? 0);
  return {
    total: comparisons.length,
    counts,
    conclusion:
      regressions > 0 ? "failure" : infrastructure === comparisons.length && comparisons.length > 0 ? "neutral" : "success",
    title:
      regressions > 0
        ? `${regressions} downstream regression${regressions === 1 ? "" : "s"} detected`
        : "No candidate-only regressions detected",
    summary: Object.entries(counts)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${value} ${key}`)
      .join(" · "),
  };
}

export function githubCheckOutput(comparisons: Comparison[]): { title: string; summary: string; text: string } {
  const summary = summarizeComparisons(comparisons);
  const regressions = comparisons.filter((item) => item.classification === "newly-broken");
  const text = regressions.length
    ? regressions
        .map((item, index) =>
          [
            `### Regression ${index + 1}${item.downstream ? ` — ${item.downstream.repository}` : ""}`,
            item.downstream ? `Downstream ref: \`${item.downstream.ref}\`` : "",
            item.reason,
            item.candidateSignature ? `Signature: \`${item.candidateSignature}\`` : "",
            item.analysis ? `**ANALYSIS (${item.analysis.harness})**\n\n${sanitizeLog(item.analysis.raw, 4_000)}` : "",
            "<details><summary>Baseline log excerpt</summary>",
            "",
            "```text",
            sanitizeLog(`${item.baseline.test.stderr}\n${item.baseline.test.stdout}`, 6_000),
            "```",
            "</details>",
            "<details><summary>Candidate log excerpt</summary>",
            "",
            "```text",
            sanitizeLog(`${item.candidate.test.stderr}\n${item.candidate.test.stdout}`, 6_000),
            "```",
            "</details>",
          ]
            .filter(Boolean)
            .join("\n"),
        )
        .join("\n\n")
    : "Baseline/candidate comparison found no candidate-only failures.";
  return {
    title: summary.title.slice(0, 255),
    summary: summary.summary.slice(0, 65_535),
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
