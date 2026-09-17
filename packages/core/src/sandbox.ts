import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { runProcess } from "./process.js";
import type { CommandResult, ResourceLimits } from "./types.js";

const defaults: ResourceLimits = { cpus: 2, memoryMb: 2048, pids: 256, timeoutSeconds: 900 };
const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;

export interface SandboxMount {
  source: string;
  target: string;
  readOnly?: boolean;
}

export interface SandboxCommand {
  image: string;
  workspace: string;
  command: string;
  env?: Record<string, string>;
  network?: "none" | "bridge";
  resources?: Partial<ResourceLimits>;
  mounts?: SandboxMount[];
  kind?: CommandResult["kind"];
}

export async function runInDocker(spec: SandboxCommand): Promise<CommandResult> {
  const limits = { ...defaults, ...spec.resources };
  const name = `downstreamci-${randomUUID()}`;
  const clientEnv: Record<string, string> = {};
  const args = [
    "run",
    "--rm",
    "--name",
    name,
    "--init",
    "--read-only",
    "--cap-drop=ALL",
    "--security-opt=no-new-privileges",
    "--pids-limit",
    String(limits.pids),
    "--cpus",
    String(limits.cpus),
    "--memory",
    `${limits.memoryMb}m`,
    "--network",
    spec.network ?? "none",
    "--tmpfs",
    "/tmp:rw,nosuid,nodev,size=1g",
    "--mount",
    mountArg({ source: spec.workspace, target: "/workspace" }),
    "--workdir",
    "/workspace",
    "--env",
    "HOME=/workspace/.downstreamci/home",
    "--env",
    "XDG_CACHE_HOME=/workspace/.downstreamci/cache",
  ];

  const uid = typeof process.getuid === "function" ? process.getuid() : undefined;
  const gid = typeof process.getgid === "function" ? process.getgid() : undefined;
  if (uid !== undefined && gid !== undefined) args.push("--user", `${uid}:${gid}`);

  for (const mount of spec.mounts ?? []) args.push("--mount", mountArg(mount));
  for (const [key, value] of Object.entries(spec.env ?? {})) {
    if (!ENV_KEY.test(key)) throw new Error(`Invalid environment variable name: ${key}`);
    clientEnv[key] = value;
    args.push("--env", key);
  }

  const wrapped = [
    "mkdir -p .downstreamci/home .downstreamci/cache",
    `timeout --kill-after=5s ${Math.ceil(limits.timeoutSeconds)}s sh -lc ${shellQuote(spec.command)}`,
  ].join(" && ");
  args.push(spec.image, "sh", "-lc", wrapped);

  try {
    const result = await runProcess("docker", args, {
      env: clientEnv,
      timeoutSeconds: limits.timeoutSeconds + 15,
      kind: spec.kind ?? "test",
    });
    if (result.timedOut) await cleanupContainer(name);
    if (result.exitCode === 124) return { ...result, timedOut: true };
    return result;
  } catch (error) {
    await cleanupContainer(name);
    return {
      command: `docker run --name ${name} <redacted-args>`,
      exitCode: null,
      stdout: "",
      stderr: error instanceof Error ? error.message : String(error),
      durationMs: 0,
      timedOut: false,
      kind: "infrastructure",
    };
  }
}

function mountArg(mount: SandboxMount): string {
  const source = resolve(mount.source);
  const readonly = mount.readOnly ? ",readonly" : "";
  return `type=bind,source=${source},target=${mount.target}${readonly}`;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

async function cleanupContainer(name: string): Promise<void> {
  try {
    await runProcess("docker", ["rm", "-f", name], { timeoutSeconds: 15, maxOutputBytes: 64 * 1024 });
  } catch {
    // Best-effort cleanup only; the original infrastructure error is more useful to the caller.
  }
}
