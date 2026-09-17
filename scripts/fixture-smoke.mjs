import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { spawn } from "node:child_process";

const root = resolve(new URL("..", import.meta.url).pathname);
const temp = await mkdtemp(join(tmpdir(), "downstreamci-fixture-"));

try {
  const candidateSource = join(root, "fixtures/npm/upstream-lib");
  const packed = await run("npm", ["pack", candidateSource, "--pack-destination", temp], root);
  assert(packed.code === 0, `candidate pack failed: ${packed.stderr}`);
  const tarballName = packed.stdout.trim().split("\n").at(-1);
  assert(tarballName, "npm pack did not return a tarball name");
  const tarball = join(temp, basename(tarballName));

  const regression = await exercise("downstream-good", tarball);
  assert(regression.baseline === 0, "regression fixture baseline must pass");
  assert(regression.candidate !== 0, "regression fixture candidate must fail");

  const preexisting = await exercise("downstream-baseline-failing", tarball);
  assert(preexisting.baseline !== 0, "pre-existing fixture baseline must fail");
  assert(preexisting.candidate !== 0, "pre-existing fixture candidate must also fail");

  console.log("fixture smoke: baseline-pass/candidate-fail and pre-existing-failure cases verified");
} finally {
  await rm(temp, { recursive: true, force: true });
}

async function exercise(name, candidateTarball) {
  const source = join(root, "fixtures/npm", name);
  const target = join(temp, name);
  await cp(source, target, { recursive: true });
  await cp(join(root, "fixtures/npm/published-upstream"), join(temp, "published-upstream"), { recursive: true });

  let result = await run("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund"], target);
  assert(result.code === 0, `${name} baseline install failed: ${result.stderr}`);
  result = await run("npm", ["test"], target);
  const baseline = result.code;

  result = await run("npm", ["install", "--no-save", "--ignore-scripts", "--no-audit", "--no-fund", candidateTarball], target);
  assert(result.code === 0, `${name} candidate injection failed: ${result.stderr}`);
  result = await run("npm", ["test"], target);
  return { baseline, candidate: result.code };
}

function run(command, args, cwd) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"], shell: false });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (value) => { stdout += value; });
    child.stderr.on("data", (value) => { stderr += value; });
    child.on("error", reject);
    child.on("close", (code) => resolvePromise({ code, stdout, stderr }));
  });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
