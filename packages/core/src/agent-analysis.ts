import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getHarness } from "./harnesses.js";
import { runProcess } from "./process.js";

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
    "", "UPSTREAM DIFF:", context.upstreamDiff.slice(0, 8_000),
    "", `CANDIDATE METADATA: ${JSON.stringify(context.candidateMetadata)}`,
    "", "BASELINE LOG:", context.baselineLog.slice(-5_000),
    "", "CANDIDATE LOG:", context.candidateLog.slice(-8_000),
    "", "DEPENDENCY MANIFEST:", context.dependencyManifest.slice(0, 3_000),
    "", `RUNTIME: ${JSON.stringify(context.runtime)}`,
  ].join("\n");
}

export async function analyzeFailure(harnessId: string, context: AnalysisContext): Promise<AgentAnalysis> {
  const harness = getHarness(harnessId);
  const prompt = buildAnalysisPrompt(context);
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
    if (result.exitCode !== 0) throw new Error(`${harness.displayName} analysis failed: ${result.stderr}`);
    return { harness: harness.id, raw: result.stdout, label: "ANALYSIS" };
  } finally {
    await rm(analysisDir, { recursive: true, force: true });
  }
}
