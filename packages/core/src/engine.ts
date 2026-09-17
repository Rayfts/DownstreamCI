import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compareExecutions } from "./compare.js";
import { runProcess } from "./process.js";
import type { Comparison, DownstreamSpec, Execution } from "./types.js";

export interface PairRunner {
  runBaseline(workspace: string, spec: DownstreamSpec): Promise<Execution>;
  runCandidate(workspace: string, spec: DownstreamSpec): Promise<Execution>;
}

function repositoryUrl(repository: string): string {
  if (/^(?:https?:\/\/|ssh:\/\/|git@|file:\/\/|\/|\.\.?\/)/.test(repository)) return repository;
  if (/^[\w.-]+\/[\w.-]+$/.test(repository)) return `https://github.com/${repository}.git`;
  return repository;
}

export async function checkoutRepository(repository: string, ref: string, parent: string, name = "repo"): Promise<string> {
  const target = join(parent, name);
  const gitHome = join(parent, ".git-home");
  await mkdir(gitHome, { recursive: true, mode: 0o700 });
  await prepareGitCredential(gitHome, repositoryUrl(repository));
  const env = {
    HOME: gitHome,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
  };

  const init = await runProcess("git", ["init", "--quiet", target], { timeoutSeconds: 30, kind: "setup", env });
  if (init.exitCode !== 0) throw new Error(`git init failed: ${init.stderr}`);
  const remote = await runProcess("git", ["remote", "add", "origin", repositoryUrl(repository)], {
    cwd: target,
    timeoutSeconds: 30,
    kind: "setup",
    env,
  });
  if (remote.exitCode !== 0) throw new Error(`git remote setup failed: ${remote.stderr}`);
  const fetch = await runProcess(
    "git",
    ["fetch", "--quiet", "--no-tags", "--depth=1", "--filter=blob:none", "origin", ref],
    { cwd: target, timeoutSeconds: 180, kind: "setup", env },
  );
  if (fetch.exitCode !== 0) throw new Error(`fetch failed for ${repository}@${ref}: ${fetch.stderr}`);
  const checkout = await runProcess("git", ["checkout", "--quiet", "--detach", "FETCH_HEAD"], {
    cwd: target,
    timeoutSeconds: 60,
    kind: "setup",
    env,
  });
  if (checkout.exitCode !== 0) throw new Error(`checkout failed: ${checkout.stderr}`);
  return target;
}

export async function cloneDownstream(spec: DownstreamSpec, parent: string, name = "repo"): Promise<string> {
  return checkoutRepository(spec.repository, spec.ref, parent, name);
}

export async function runComparison(spec: DownstreamSpec, runner: PairRunner): Promise<Comparison> {
  const temp = await mkdtemp(join(tmpdir(), "downstreamci-"));
  try {
    const baselineWorkspace = await cloneDownstream(spec, temp, "baseline");
    const candidateWorkspace = await cloneDownstream(spec, temp, "candidate");
    const baseline = await runner.runBaseline(baselineWorkspace, spec);
    const candidate = await runner.runCandidate(candidateWorkspace, spec);
    return {
      ...compareExecutions(baseline, candidate),
      downstream: {
        repository: spec.repository,
        ref: spec.ref,
        ecosystem: spec.ecosystem,
        ...(spec.tags ? { tags: spec.tags } : {}),
        ...(spec.priority ? { priority: spec.priority } : {}),
      },
    };
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

async function prepareGitCredential(gitHome: string, repository: string): Promise<void> {
  const token = process.env.DOWNSTREAMCI_GITHUB_READ_TOKEN;
  if (!token || !repository.startsWith("https://github.com/")) return;
  await writeFile(
    join(gitHome, ".netrc"),
    `machine github.com\nlogin x-access-token\npassword ${token}\n`,
    { mode: 0o600 },
  );
}
