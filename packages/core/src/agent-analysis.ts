import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getHarness } from "./harnesses.js";
import { runProcess } from "./process.js";
import { sanitizeLog } from "./reporting.js";
import type { Comparison } from "./types.js";

export interface AnalysisContext {
  upstreamDiff: string;
  candidateMetadata: Record<string, string>;
  baselineLog: string;
  candidateLog: string;
  dependencyManifest: string;
  runtime: Record<string, string>;
}

export interface AgentAnalysis {
  harness: string;
  raw: string;
  label: "ANALYSIS";
}

export function buildAnalysisPrompt(context: AnalysisContext): string {
  return [
    "You are analyzing a deterministic reverse-dependency CI comparison.",
    "CI has already determined pass/fail. Do not override CI facts.",
    "Classify the candidate-only failure as one of: likely upstream regression, intentional breaking change, downstream relying on undocumented behavior, downstream misuse, flaky, environment issue, uncertain.",
    "Explain evidence and uncertainty. Do not edit files or run network-changing commands.",
    "",
    "UPSTREAM DIFF:",
    sanitizeLog(context.upstreamDiff, 8_000),
    "",
    `CANDIDATE METADATA: ${sanitizeLog(JSON.stringify(context.candidateMetadata), 4_000)}`,
    "",
    "BASELINE LOG:",
    sanitizeLog(context.baselineLog, 5_000),
    "",
    "CANDIDATE LOG:",
    sanitizeLog(context.candidateLog, 8_000),
    "",
    "DEPENDENCY MANIFEST:",
    sanitizeLog(context.dependencyManifest, 3_000),
    "",
    `RUNTIME: ${sanitizeLog(JSON.stringify(context.runtime), 4_000)}`,
  ].join("\n");
}

export function buildSemanticClusterPrompt(comparisons: Comparison[]): string {
  const regressions = comparisons.filter((comparison) => comparison.classification === "newly-broken");
  const deterministic = new Map<
    string,
    { id: string; label: string; repositories: string[]; reason: string; excerpt: string }
  >();

  for (const comparison of regressions) {
    const id = comparison.cluster?.id ?? `signature-${comparison.candidateSignature ?? "unknown"}`;
    const current = deterministic.get(id) ?? {
      id,
      label: comparison.cluster?.label ?? "candidate-only failure",
      repositories: [],
      reason: comparison.reason,
      excerpt: sanitizeLog(`${comparison.candidate.test.stderr}\n${comparison.candidate.test.stdout}`, 2_500),
    };
    current.repositories.push(comparison.downstream?.repository ?? "downstream");
    deterministic.set(id, current);
  }

  const evidence = [...deterministic.values()].map((cluster) => ({
    id: cluster.id,
    deterministicLabel: sanitizeLog(cluster.label, 500),
    repositories: cluster.repositories,
    reason: cluster.reason,
    candidateLogExcerpt: cluster.excerpt,
  }));

  return [
    "You are performing OPTIONAL semantic clustering over deterministic reverse-dependency CI failure clusters.",
    "The deterministic cluster IDs and CI classifications are facts. Do not merge, remove, relabel, or override CI facts.",
    "Your job is only to suggest higher-level semantic families that may help a maintainer understand related failures.",
    "Return concise JSON with an array named semanticFamilies. Each family should contain a short name, clusterIds, rationale, and uncertainty.",
    "If evidence is insufficient, keep clusters separate and say so.",
    "Do not edit files or run network-changing commands.",
    "",
    `DETERMINISTIC CLUSTERS: ${sanitizeLog(JSON.stringify(evidence, null, 2), 24_000)}`,
  ].join("\n");
}

export async function analyzeFailure(harnessId: string, context: AnalysisContext): Promise<AgentAnalysis> {
  return runHarnessAnalysis(harnessId, buildAnalysisPrompt(context));
}

export async function analyzeFailureClusters(harnessId: string, comparisons: Comparison[]): Promise<AgentAnalysis> {
  const regressions = comparisons.filter((comparison) => comparison.classification === "newly-broken");
  if (regressions.length === 0) throw new Error("Semantic cluster analysis requires at least one newly-broken comparison");
  return runHarnessAnalysis(harnessId, buildSemanticClusterPrompt(comparisons));
}

async function runHarnessAnalysis(harnessId: string, prompt: string): Promise<AgentAnalysis> {
  const harness = getHarness(harnessId);
  const invocation = harness.buildInvocation(prompt);
  if (!invocation) throw new Error(`${harness.displayName} has no verified automated invocation`);

  const analysisDir = await mkdtemp(join(tmpdir(), "downstreamci-analysis-"));
  try {
    await writeFile(join(analysisDir, "EVIDENCE.txt"), prompt, { mode: 0o600 });
    const result = await runProcess(invocation.command, invocation.args, {
      cwd: analysisDir,
      timeoutSeconds: 600,
      maxOutputBytes: 2 * 1024 * 1024,
    });
    if (result.exitCode !== 0) throw new Error(`${harness.displayName} analysis failed: ${sanitizeLog(result.stderr, 4_000)}`);
    return { harness: harness.id, raw: sanitizeLog(result.stdout, 128_000), label: "ANALYSIS" };
  } finally {
    await rm(analysisDir, { recursive: true, force: true });
  }
}
