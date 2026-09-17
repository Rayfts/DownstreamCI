import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { sanitizeLog } from "./reporting.js";
import type { ArtifactReference, Comparison, Execution } from "./types.js";

const MAX_ARTIFACT_LOG_CHARS = 4 * 1024 * 1024;

export async function writeRunArtifacts(
  root: string,
  runId: string,
  comparisons: Comparison[],
): Promise<Comparison[]> {
  const runDirectory = join(root, runId);
  await mkdir(runDirectory, { recursive: true, mode: 0o700 });
  const enriched: Comparison[] = [];

  for (const comparison of comparisons) {
    const repository = comparison.downstream?.repository ?? "downstream";
    const ref = comparison.downstream?.ref ?? "unknown";
    const id = createHash("sha256").update(`${repository}@${ref}`).digest("hex").slice(0, 10);
    const directory = join(runDirectory, `${safeName(repository)}-${id}`);
    await mkdir(directory, { recursive: true, mode: 0o700 });

    const artifacts: ArtifactReference[] = [
      await writeArtifact(
        root,
        join(directory, "baseline.log"),
        "baseline-log",
        sanitizeLog(`${comparison.baseline.test.stderr}\n${comparison.baseline.test.stdout}`, MAX_ARTIFACT_LOG_CHARS),
      ),
      await writeArtifact(
        root,
        join(directory, "candidate.log"),
        "candidate-log",
        sanitizeLog(`${comparison.candidate.test.stderr}\n${comparison.candidate.test.stdout}`, MAX_ARTIFACT_LOG_CHARS),
      ),
    ];
    artifacts.push(
      await writeArtifact(
        root,
        join(directory, "comparison.json"),
        "comparison",
        JSON.stringify(
          {
            downstream: comparison.downstream,
            classification: comparison.classification,
            confidence: comparison.confidence,
            cluster: comparison.cluster,
            reason: comparison.reason,
            baselineSignature: comparison.baselineSignature,
            candidateSignature: comparison.candidateSignature,
            baseline: evidenceExecution(comparison.baseline),
            candidate: evidenceExecution(comparison.candidate),
            analysis: comparison.analysis
              ? { ...comparison.analysis, raw: sanitizeLog(comparison.analysis.raw, 64_000) }
              : undefined,
          },
          null,
          2,
        ),
      ),
    );
    enriched.push({ ...comparison, artifacts });
  }

  await writeFile(
    join(runDirectory, "manifest.json"),
    JSON.stringify(
      {
        runId,
        createdAt: new Date().toISOString(),
        comparisons: enriched.map((comparison) => ({
          downstream: comparison.downstream,
          classification: comparison.classification,
          confidence: comparison.confidence,
          cluster: comparison.cluster,
          artifacts: comparison.artifacts,
        })),
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  return enriched;
}

async function writeArtifact(
  root: string,
  path: string,
  kind: ArtifactReference["kind"],
  content: string,
): Promise<ArtifactReference> {
  await writeFile(path, content, { mode: 0o600 });
  return {
    kind,
    path: relative(root, path),
    sha256: createHash("sha256").update(content).digest("hex"),
    bytes: Buffer.byteLength(content, "utf8"),
  };
}

function safeName(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "downstream";
}

function evidenceExecution(execution: Execution) {
  return {
    ...(execution.setup
      ? {
          setup: {
            command: execution.setup.command,
            exitCode: execution.setup.exitCode,
            durationMs: execution.setup.durationMs,
            timedOut: execution.setup.timedOut,
          },
        }
      : {}),
    test: {
      command: execution.test.command,
      exitCode: execution.test.exitCode,
      durationMs: execution.test.durationMs,
      timedOut: execution.test.timedOut,
    },
    attempts: execution.attempts.map((attempt) => ({
      command: attempt.command,
      exitCode: attempt.exitCode,
      durationMs: attempt.durationMs,
      timedOut: attempt.timedOut,
    })),
    environment: execution.environment,
  };
}
