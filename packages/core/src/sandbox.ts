import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { runProcess } from "./process.js";
import type { CommandResult, ResourceLimits, ServiceSpec } from "./types.js";

const defaults: ResourceLimits = { cpus: 2, memoryMb: 2048, pids: 256, timeoutSeconds: 900 };
const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;
const SERVICE_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;

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
  network?: "none" | "bridge" | string;
  resources?: Partial<ResourceLimits>;
  mounts?: SandboxMount[];
  kind?: CommandResult["kind"];
}

export interface ServiceStack {
  network: string;
  environment: Record<string, string>;
  cleanup(): Promise<void>;
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

export function normalizeServices(services: Array<string | ServiceSpec>): ServiceSpec[] {
  const used = new Set<string>();
  return services.map((service, index) => {
    const normalized = typeof service === "string" ? { name: imageName(service, index), image: service } : { ...service };
    let name = normalized.name;
    if (!SERVICE_NAME.test(name)) throw new Error(`Invalid service name: ${name}`);
    if (used.has(name)) {
      let suffix = 2;
      while (used.has(`${name}-${suffix}`)) suffix += 1;
      name = `${name}-${suffix}`;
    }
    used.add(name);
    return { ...normalized, name };
  });
}

export async function startServiceStack(
  services: Array<string | ServiceSpec>,
  options: { allowInternet?: boolean } = {},
): Promise<ServiceStack> {
  const normalized = normalizeServices(services);
  const network = `downstreamci-net-${randomUUID()}`;
  const containers: string[] = [];
  const networkArgs = ["network", "create", ...(options.allowInternet ? [] : ["--internal"]), network];
  const created = await runProcess("docker", networkArgs, { timeoutSeconds: 30, maxOutputBytes: 64 * 1024 });
  if (created.exitCode !== 0) throw new Error(`Unable to create isolated service network: ${created.stderr}`);

  try {
    const environment: Record<string, string> = {};
    for (const service of normalized) {
      const container = `downstreamci-svc-${randomUUID()}`;
      containers.push(container);
      const clientEnv: Record<string, string> = {};
      const args = [
        "run",
        "-d",
        "--rm",
        "--name",
        container,
        "--network",
        network,
        "--network-alias",
        service.name,
        "--cap-drop=ALL",
        "--security-opt=no-new-privileges",
        "--pids-limit",
        String(service.pids ?? 128),
        "--memory",
        `${service.memoryMb ?? 512}m`,
        "--tmpfs",
        "/tmp:rw,nosuid,nodev,size=256m",
      ];
      if (service.readOnly !== false) args.push("--read-only");
      for (const tmpfs of service.tmpfs ?? []) args.push("--tmpfs", `${tmpfs}:rw,nosuid,nodev`);
      for (const [key, value] of Object.entries(service.env ?? {})) {
        if (!ENV_KEY.test(key)) throw new Error(`Invalid service environment variable name: ${key}`);
        clientEnv[key] = value;
        args.push("--env", key);
      }
      if (service.healthcheck) {
        args.push("--health-cmd", service.healthcheck, "--health-interval", "1s", "--health-timeout", "5s");
      }
      args.push(service.image, ...(service.command ?? []));
      const started = await runProcess("docker", args, { env: clientEnv, timeoutSeconds: 60, maxOutputBytes: 128 * 1024 });
      if (started.exitCode !== 0) throw new Error(`Unable to start service ${service.name}: ${started.stderr}`);
      await waitForService(container, Boolean(service.healthcheck), service.healthTimeoutSeconds ?? 60);
      const key = service.name.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
      environment[`DOWNSTREAMCI_SERVICE_${key}_HOST`] = service.name;
      if (service.port) environment[`DOWNSTREAMCI_SERVICE_${key}_PORT`] = String(service.port);
    }
    return {
      network,
      environment,
      cleanup: () => cleanupServiceStack(containers, network),
    };
  } catch (error) {
    await cleanupServiceStack(containers, network);
    throw error;
  }
}

function imageName(image: string, index: number): string {
  const withoutDigest = image.split("@")[0] ?? image;
  const last = withoutDigest.split("/").at(-1) ?? `service-${index + 1}`;
  const base = last.split(":")[0] ?? `service-${index + 1}`;
  const name = base.replace(/[^A-Za-z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "");
  return name || `service-${index + 1}`;
}

async function waitForService(container: string, hasHealthcheck: boolean, timeoutSeconds: number): Promise<void> {
  const deadline = Date.now() + timeoutSeconds * 1000;
  while (Date.now() < deadline) {
    const format = hasHealthcheck ? "{{.State.Health.Status}}" : "{{.State.Status}}";
    const state = await runProcess("docker", ["inspect", "--format", format, container], {
      timeoutSeconds: 10,
      maxOutputBytes: 16 * 1024,
    });
    const value = state.stdout.trim();
    if (state.exitCode === 0 && (value === "healthy" || (!hasHealthcheck && value === "running"))) return;
    if (value === "unhealthy" || value === "exited" || value === "dead") {
      throw new Error(`Service container ${container} entered ${value} state`);
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
  }
  throw new Error(`Service container ${container} was not ready within ${timeoutSeconds}s`);
}

async function cleanupServiceStack(containers: string[], network: string): Promise<void> {
  for (const container of [...containers].reverse()) await cleanupContainer(container);
  try {
    await runProcess("docker", ["network", "rm", network], { timeoutSeconds: 15, maxOutputBytes: 64 * 1024 });
  } catch {
    // Best-effort cleanup only.
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
