#!/usr/bin/env node
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { executeConfiguredPipeline } from "../packages/core/dist/index.js";

const exec = promisify(execFile);
const root = await mkdtemp(join(tmpdir(), "downstreamci-docker-integration-"));

try {
  const upstream = join(root, "upstream");
  const downstream = join(root, "downstream");
  const baselineUpstream = join(downstream, "baseline-upstream");
  await mkdir(upstream, { recursive: true });
  await mkdir(baselineUpstream, { recursive: true });

  await writeFile(join(upstream, "go.mod"), "module example.com/upstream\n\ngo 1.19\n");
  await writeFile(join(upstream, "upstream.go"), "package upstream\n\nfunc Value() int { return 2 }\n");
  await git(upstream, ["init", "--quiet"]);
  await git(upstream, ["config", "user.name", "DownstreamCI Fixture"]);
  await git(upstream, ["config", "user.email", "fixture@downstreamci.invalid"]);
  await git(upstream, ["add", "."]);
  await git(upstream, ["commit", "--quiet", "-m", "candidate fixture"]);

  await writeFile(
    join(downstream, "go.mod"),
    [
      "module example.com/downstream",
      "",
      "go 1.19",
      "",
      "require example.com/upstream v0.0.0",
      "",
      "replace example.com/upstream => ./baseline-upstream",
      "",
    ].join("\n"),
  );
  await writeFile(join(downstream, "placeholder.go"), "package downstream\n");
  await writeFile(
    join(downstream, "main_test.go"),
    [
      "package downstream",
      "",
      "import (",
      '  "testing"',
      '  upstream "example.com/upstream"',
      ")",
      "",
      "func TestCompatibility(t *testing.T) {",
      "  if got := upstream.Value(); got != 1 {",
      '    t.Fatalf("expected baseline API value 1, got %d", got)',
      "  }",
      "}",
      "",
    ].join("\n"),
  );
  await writeFile(join(baselineUpstream, "go.mod"), "module example.com/upstream\n\ngo 1.19\n");
  await writeFile(join(baselineUpstream, "upstream.go"), "package upstream\n\nfunc Value() int { return 1 }\n");

  await git(downstream, ["init", "--quiet"]);
  await git(downstream, ["config", "user.name", "DownstreamCI Fixture"]);
  await git(downstream, ["config", "user.email", "fixture@downstreamci.invalid"]);
  await git(downstream, ["add", "."]);
  await git(downstream, ["commit", "--quiet", "-m", "fixture baseline"]);
  const { stdout } = await git(downstream, ["rev-parse", "HEAD"]);
  const ref = stdout.trim();

  const comparisons = await executeConfiguredPipeline(
    upstream,
    {
      version: 1,
      downstreams: [
        {
          repository: downstream,
          ref,
          ecosystem: "go",
          test: "go test ./...",
          network: { mode: "none" },
        },
      ],
    },
    { runnerImage: "downstreamci/runner:ci", retries: 2 },
  );

  const comparison = comparisons[0];
  if (!comparison) throw new Error("Docker integration produced no comparison");
  if (comparison.baseline.test.exitCode !== 0) {
    throw new Error(`Expected baseline pass, got: ${comparison.baseline.test.stderr || comparison.baseline.test.stdout}`);
  }
  if (comparison.candidate.test.exitCode === 0) {
    throw new Error("Expected candidate failure after local Go module replacement");
  }
  if (comparison.classification !== "newly-broken") {
    throw new Error(`Expected newly-broken, got ${comparison.classification}: ${comparison.reason}`);
  }

  console.log("Docker integration PASS: baseline passed, candidate failed, classification=newly-broken");
} finally {
  await rm(root, { recursive: true, force: true });
}

async function git(cwd, args) {
  return exec("git", args, {
    cwd,
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0" },
  });
}
