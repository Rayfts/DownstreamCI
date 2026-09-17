#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Command } from "commander";
import {
  DockerPairRunner,
  RunStore,
  analyzeFailure,
  cloneDownstream,
  clusterComparisons,
  detectEcosystem,
  ecosystemAdapter,
  getHarness,
  harnesses,
  loadConfig,
  runComparison,
  runProcess,
  summarizeComparisons,
  writeRunArtifacts,
  type CandidateArtifact,
  type Comparison,
  type DownstreamConfig,
  type DownstreamSpec,
  type EcosystemAdapter,
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
  .option("--retries <count>", "test attempts used for flake detection", parsePositiveInt, 2)
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
    const finalComparisons = await writeRunArtifacts(
      resolve(upstream, ".downstreamci/artifacts"),
      runId,
      clustered,
    );
    const store = new RunStore(resolve(upstream, ".downstreamci/downstreamci.db"));
    try {
      store.save(runId, upstream, await currentRef(upstream), finalComparisons);
    } finally {
      store.close();
    }

    const summary = summarizeComparisons(finalComparisons);
    if (options.json) {
      console.log(JSON.stringify({ runId, summary, comparisons: finalComparisons }, null, 2));
    } else {
      for (const comparison of finalComparisons) printComparison(comparison);
      console.log(`\nRun ${runId}`);
      console.log(`${summary.title}: ${summary.summary || "no downstreams"}`);
      console.log(`Evidence: ${resolve(upstream, ".downstreamci/artifacts", runId)}`);
    }
    if ((summary.counts["newly-broken"] ?? 0) > 0) process.exitCode = 2;
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
    if (result.classification === "newly-broken") process.exitCode = 2;
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
  .option("--limit <count>", "recent runs to inspect", parsePositiveInt, 100)
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
  .description("suggest downstream repositories using GitHub code search")
  .option("--limit <count>", "maximum suggestions", parsePositiveInt, 20)
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
    for (const item of suggestions) console.log(`- ${item.repository}  ${item.url}`);
    console.log("\nSuggestions are non-blocking until a maintainer pins and adds them to .downstreamci.yml.");
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

interface DiscoverySuggestion {
  repository: string;
  url: string;
}

async function discoverOnGitHub(candidate: CandidateArtifact, limit: number): Promise<DiscoverySuggestion[]> {
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
  url.searchParams.set("per_page", String(Math.min(limit, 100)));
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "DownstreamCI/0.1",
  };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`GitHub discovery failed (${response.status}): ${await response.text()}`);
  const payload = (await response.json()) as {
    items?: Array<{ repository?: { full_name?: string; html_url?: string } }>;
  };
  const unique = new Map<string, DiscoverySuggestion>();
  for (const item of payload.items ?? []) {
    const repository = item.repository?.full_name;
    const url = item.repository?.html_url;
    if (repository && url && !unique.has(repository)) unique.set(repository, { repository, url });
    if (unique.size >= limit) break;
  }
  return [...unique.values()];
}

function parsePositiveInt(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) throw new Error("value must be an integer from 1 to 100");
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
