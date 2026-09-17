#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Command } from "commander";
import {
  DockerPairRunner,
  RunStore,
  analyzeFailure,
  analyzeFailureClusters,
  cloneDownstream,
  clusterComparisons,
  detectEcosystem,
  ecosystemAdapter,
  getHarness,
  harnesses,
  loadConfig,
  rankDiscoveryCandidates,
  runComparison,
  runProcess,
  summarizeComparisons,
  writeRunArtifacts,
  type CandidateArtifact,
  type Comparison,
  type DiscoveryCandidate,
  type DownstreamConfig,
  type DownstreamSpec,
  type EcosystemAdapter,
  type RankedDiscoveryCandidate,
} from "@downstreamci/core";

const program = new Command()
  .name("downstreamci")
  .description("Evidence-backed reverse-dependency CI")
  .version("0.1.0");

program
  .command("run")
  .argument("[path]", "upstream repository", ".")
  .option("--config <path>", "config file", ".downstreamci.yml")
  .option("--harness <id>", "agent harness for candidate-only failure analysis")
  .option("--runner-image <image>", "sandbox image", "downstreamci/runner:local")
  .option("--retries <count>", "test attempts used for flake detection", parseRetryCount, 2)
  .option("--json", "emit the machine-readable run result")
  .action(async (path: string, options: RunOptions) => {
    const upstream = resolve(path);
    const config = await loadConfig(resolve(upstream, options.config));
    const adapter = await resolveAdapter(upstream, config);
    const candidate = await adapter.buildCandidate(upstream);
    const runner = new DockerPairRunner({
      candidate,
      adapter,
      image: options.runnerImage,
      retries: options.retries,
    });
    const comparisons: Comparison[] = [];
    const upstreamDiff = options.harness ? await currentDiff(upstream) : "";

    if (options.harness) {
      const harness = getHarness(options.harness);
      if (!harness.automated) throw new Error(`${harness.displayName}: ${harness.notes}`);
    }

    for (const spec of config.downstreams) {
      validateEcosystem(spec, adapter);
      const comparison = await runComparison(spec, runner);
      if (options.harness && comparison.classification === "newly-broken") {
        try {
          comparison.analysis = await analyzeFailure(options.harness, {
            upstreamDiff,
            candidateMetadata: { ...candidate.metadata, identity: candidate.identity, ecosystem: candidate.ecosystem },
            baselineLog: combinedLog(comparison.baseline.test),
            candidateLog: combinedLog(comparison.candidate.test),
            dependencyManifest: `Downstream: ${spec.repository}@${spec.ref}. The sandbox checkout is intentionally disposable.`,
            runtime: comparison.candidate.environment,
          });
        } catch (error) {
          comparison.analysis = {
            harness: options.harness,
            label: "ANALYSIS",
            raw: `Agent analysis unavailable: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      }
      comparisons.push(comparison);
    }

    const runId = randomUUID();
    const clustered = clusterComparisons(comparisons);
    let semanticClustering: { harness: string; raw: string; label: "ANALYSIS" } | undefined;
    if (options.harness && clustered.some((comparison) => comparison.classification === "newly-broken")) {
      try {
        semanticClustering = await analyzeFailureClusters(options.harness, clustered);
      } catch {
        semanticClustering = {
          harness: options.harness,
          label: "ANALYSIS",
          raw: "Semantic cluster analysis was unavailable. Deterministic cluster IDs and CI classifications are unchanged.",
        };
      }
    }

    const evidenceRoot = resolve(upstream, ".downstreamci/artifacts");
    const finalComparisons = await writeRunArtifacts(evidenceRoot, runId, clustered);
    if (semanticClustering && options.harness) {
      await writeFile(
        resolve(evidenceRoot, runId, `semantic-clusters-${options.harness}.txt`),
        `${semanticClustering.raw}\n`,
        { mode: 0o600 },
      );
    }

    const store = new RunStore(resolve(upstream, ".downstreamci/downstreamci.db"));
    try {
      store.save(runId, upstream, await currentRef(upstream), finalComparisons);
    } finally {
      store.close();
    }

    const summary = summarizeComparisons(finalComparisons);
    if (options.json) {
      console.log(JSON.stringify({ runId, summary, comparisons: finalComparisons, semanticClustering }, null, 2));
    } else {
      for (const comparison of finalComparisons) printComparison(comparison);
      console.log(`\nRun ${runId}`);
      console.log(`${summary.title}: ${summary.summary || "no downstreams"}`);
      if (semanticClustering) {
        console.log(`\nANALYSIS semantic clustering (${semanticClustering.harness}):`);
        console.log(semanticClustering.raw.slice(0, 1_200));
      }
      console.log(`Evidence: ${resolve(evidenceRoot, runId)}`);
    }
    process.exitCode = conclusionExitCode(summary.conclusion);
  });

program.command("doctor").description("check local prerequisites").action(async () => {
  const checks = [
    ["git", await onPath("git")],
    ["docker", await onPath("docker")],
    [".downstreamci.yml", await fileExists(resolve(".downstreamci.yml"))],
  ] as const;
  for (const [name, ok] of checks) console.log(`${ok ? "✓" : "✗"} ${name}`);
  if (!checks.every(([, ok]) => ok)) process.exitCode = 1;
});

program.command("harnesses").description("list researched coding-agent integrations").action(() => {
  for (const harness of harnesses) {
    console.log(`${harness.id.padEnd(12)} ${harness.automated ? "automated" : "manual"}  ${harness.upstream}`);
  }
});

program.command("capabilities").argument("<harness>").action((id: string) => {
  const harness = getHarness(id);
  console.log(
    JSON.stringify(
      {
        id: harness.id,
        displayName: harness.displayName,
        upstream: harness.upstream,
        automated: harness.automated,
        structuredOutput: harness.structuredOutput,
        verifiedAt: harness.verifiedAt,
        evidence: harness.evidence,
        notes: harness.notes,
      },
      null,
      2,
    ),
  );
});

for (const mode of ["baseline", "candidate"] as const) {
  program
    .command(mode)
    .argument("<downstream>")
    .option("--path <path>", "upstream repository", ".")
    .option("--config <path>", "config file", ".downstreamci.yml")
    .option("--runner-image <image>", "sandbox image", "downstreamci/runner:local")
    .action(async (downstream: string, options: SingleOptions) => {
      const upstream = resolve(options.path);
      const config = await loadConfig(resolve(upstream, options.config));
      const spec = findDownstream(config, downstream);
      const adapter = await resolveAdapter(upstream, config);
      validateEcosystem(spec, adapter);
      const candidate = await adapter.buildCandidate(upstream);
      const runner = new DockerPairRunner({ candidate, adapter, image: options.runnerImage, retries: 1 });
      const execution = await runSingle(mode, spec, runner);
      console.log(JSON.stringify(execution, null, 2));
      if (execution.test.exitCode !== 0) process.exitCode = 1;
    });
}

program
  .command("test")
  .argument("<downstream>")
  .option("--path <path>", "upstream repository", ".")
  .option("--config <path>", "config file", ".downstreamci.yml")
  .option("--runner-image <image>", "sandbox image", "downstreamci/runner:local")
  .action(async (downstream: string, options: SingleOptions) => {
    const upstream = resolve(options.path);
    const config = await loadConfig(resolve(upstream, options.config));
    const spec = findDownstream(config, downstream);
    const adapter = await resolveAdapter(upstream, config);
    validateEcosystem(spec, adapter);
    const candidate = await adapter.buildCandidate(upstream);
    const result = await runComparison(
      spec,
      new DockerPairRunner({ candidate, adapter, image: options.runnerImage, retries: 2 }),
    );
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = conclusionExitCode(summarizeComparisons([result]).conclusion);
  });

program.command("compare").argument("<run-id>").option("--path <path>", "upstream repository", ".").action(
  (runId: string, options: { path: string }) => {
    const store = new RunStore(resolve(options.path, ".downstreamci/downstreamci.db"));
    try {
      const comparisons = store.get(runId);
      if (!comparisons) throw new Error(`Unknown run: ${runId}`);
      console.log(JSON.stringify({ runId, summary: summarizeComparisons(comparisons), comparisons }, null, 2));
    } finally {
      store.close();
    }
  },
);

program
  .command("signals")
  .description("summarize repeated regressions, flaky downstreams, clusters, ecosystems, and runtimes")
  .option("--path <path>", "upstream repository", ".")
  .option("--limit <count>", "recent runs to inspect", parseLimit, 100)
  .action((options: { path: string; limit: number }) => {
    const store = new RunStore(resolve(options.path, ".downstreamci/downstreamci.db"));
    try {
      console.log(JSON.stringify(store.signals(options.limit), null, 2));
    } finally {
      store.close();
    }
  });

program
  .command("discover")
  .argument("[path]", "upstream repository", ".")
  .description("suggest and rank downstream repositories using GitHub dependency evidence")
  .option("--limit <count>", "maximum suggestions", parseLimit, 20)
  .option("--json", "emit machine-readable suggestions")
  .action(async (path: string, options: { limit: number; json?: boolean }) => {
    const upstream = resolve(path);
    const adapter = await detectEcosystem(upstream);
    const candidate = await adapter.buildCandidate(upstream);
    const suggestions = await discoverOnGitHub(candidate, options.limit);
    if (options.json) {
      console.log(JSON.stringify({ candidate: candidate.identity, ecosystem: adapter.id, suggestions }, null, 2));
      return;
    }
    console.log(`Suggested downstreams referencing ${candidate.identity}:`);
    for (const item of suggestions) {
      const updated = item.pushedAt ? item.pushedAt.slice(0, 10) : "unknown";
      console.log(`- ${item.score.toFixed(1).padStart(5)}  ${String(item.stars).padStart(6)} stars  ${item.repository}  updated ${updated}`);
    }
    console.log("\nRanking is suggestion-only. Pin and review a repository before adding it to .downstreamci.yml.");
  });

await program.parseAsync();

interface RunOptions {
  config: string;
  harness?: string;
  runnerImage: string;
  retries: number;
  json?: boolean;
}
interface SingleOptions {
  path: string;
  config: string;
  runnerImage: string;
}

type DockerRunner = DockerPairRunner;

type Conclusion = "success" | "failure" | "neutral";

function conclusionExitCode(conclusion: Conclusion): 0 | 2 | 3 {
  if (conclusion === "failure") return 2;
  if (conclusion === "neutral") return 3;
  return 0;
}

async function discoverOnGitHub(candidate: CandidateArtifact, limit: number): Promise<RankedDiscoveryCandidate[]> {
  const filename =
    candidate.ecosystem === "npm"
      ? "package.json"
      : candidate.ecosystem === "python"
        ? "pyproject.toml"
        : candidate.ecosystem === "cargo"
          ? "Cargo.toml"
          : "go.mod";
  const query = `"${candidate.identity}" filename:${filename}`;
  const url = new URL("https://api.github.com/search/code");
  url.searchParams.set("q", query);
  url.searchParams.set("per_page", String(Math.min(100, Math.max(limit, limit * 3))));
  const headers = githubHeaders();
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`GitHub discovery failed (${response.status}): ${await response.text()}`);
  const payload = (await response.json()) as {
    items?: Array<{ repository?: { full_name?: string; html_url?: string } }>;
  };
  const repositories = new Map<string, string>();
  for (const item of payload.items ?? []) {
    const repository = item.repository?.full_name;
    const repositoryUrl = item.repository?.html_url;
    if (repository && repositoryUrl && !repositories.has(repository)) repositories.set(repository, repositoryUrl);
  }

  const candidates = await Promise.all(
    [...repositories.entries()].map(([repository, repositoryUrl]) => hydrateRepository(repository, repositoryUrl, headers)),
  );
  return rankDiscoveryCandidates(candidates).slice(0, limit);
}

async function hydrateRepository(
  repository: string,
  repositoryUrl: string,
  headers: Record<string, string>,
): Promise<DiscoveryCandidate> {
  const response = await fetch(`https://api.github.com/repos/${repository}`, { headers });
  if (!response.ok) {
    return { repository, url: repositoryUrl, stars: 0, forks: 0, archived: false, isFork: false };
  }
  const data = (await response.json()) as {
    html_url?: string;
    stargazers_count?: number;
    forks_count?: number;
    archived?: boolean;
    fork?: boolean;
    pushed_at?: string | null;
  };
  return {
    repository,
    url: data.html_url ?? repositoryUrl,
    stars: data.stargazers_count ?? 0,
    forks: data.forks_count ?? 0,
    archived: data.archived ?? false,
    isFork: data.fork ?? false,
    ...(data.pushed_at ? { pushedAt: data.pushed_at } : {}),
  };
}

function githubHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "DownstreamCI/0.1",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  return headers;
}

function parseRetryCount(value: string): number {
  return parseBoundedInt(value, 1, 10, "retries");
}

function parseLimit(value: string): number {
  return parseBoundedInt(value, 1, 100, "limit");
}

function parseBoundedInt(value: string, min: number, max: number, label: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${label} must be an integer from ${min} to ${max}`);
  }
  return parsed;
}

async function resolveAdapter(upstream: string, config: DownstreamConfig): Promise<EcosystemAdapter> {
  const explicit = new Set(config.downstreams.map((item) => item.ecosystem).filter((item) => item !== "auto"));
  if (explicit.size > 1) {
    throw new Error(`One upstream package cannot use multiple ecosystem adapters: ${[...explicit].join(", ")}`);
  }
  const id = [...explicit][0];
  return id ? ecosystemAdapter(id) : detectEcosystem(upstream);
}

function validateEcosystem(spec: DownstreamSpec, adapter: EcosystemAdapter): void {
  if (spec.ecosystem !== "auto" && spec.ecosystem !== adapter.id) {
    throw new Error(`${spec.repository} requests ${spec.ecosystem}, but the upstream candidate is ${adapter.id}`);
  }
}

function findDownstream(config: DownstreamConfig, requested: string): DownstreamSpec {
  const exact = config.downstreams.find((item) => item.repository === requested);
  if (exact) return exact;
  const suffix = config.downstreams.find((item) => item.repository.endsWith(`/${requested}`));
  if (suffix) return suffix;
  throw new Error(`Downstream is not configured: ${requested}`);
}

async function runSingle(mode: "baseline" | "candidate", spec: DownstreamSpec, runner: DockerRunner) {
  const temp = await mkdtemp(join(tmpdir(), "downstreamci-single-"));
  try {
    const workspace = await cloneDownstream(spec, temp, mode);
    return mode === "baseline" ? runner.runBaseline(workspace, spec) : runner.runCandidate(workspace, spec);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

async function currentDiff(cwd: string): Promise<string> {
  const committed = await runProcess("git", ["diff", "HEAD^", "HEAD", "--"], { cwd, timeoutSeconds: 30 });
  if (committed.exitCode === 0 && committed.stdout.trim()) return committed.stdout;
  const working = await runProcess("git", ["diff", "--"], { cwd, timeoutSeconds: 30 });
  return working.exitCode === 0 ? working.stdout : "";
}

async function currentRef(cwd: string): Promise<string> {
  const result = await runProcess("git", ["rev-parse", "HEAD"], { cwd, timeoutSeconds: 30 });
  return result.exitCode === 0 ? result.stdout.trim() : "unknown";
}

function combinedLog(result: { stderr: string; stdout: string }): string {
  return `${result.stderr}\n${result.stdout}`;
}

function printComparison(comparison: Comparison): void {
  const name = comparison.downstream?.repository ?? "downstream";
  const confidence = comparison.confidence === undefined ? "" : ` ${(comparison.confidence * 100).toFixed(0)}%`;
  const cluster = comparison.cluster ? ` ${comparison.cluster.id}` : "";
  console.log(`${comparison.classification.padEnd(23)} ${name}${confidence}${cluster}`);
  if (comparison.expectedFlakeMatch) console.log(`  expected flake: ${comparison.expectedFlakeMatch}`);
  if (comparison.analysis) {
    console.log(`  ANALYSIS (${comparison.analysis.harness}): ${comparison.analysis.raw.slice(0, 500)}`);
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function onPath(binary: string): Promise<boolean> {
  const paths = (process.env.PATH ?? "").split(process.platform === "win32" ? ";" : ":");
  const suffixes = process.platform === "win32" ? [".exe", ".cmd", ".bat", ""] : [""];
  for (const base of paths) {
    for (const suffix of suffixes) if (await fileExists(join(base, `${binary}${suffix}`))) return true;
  }
  return false;
}
