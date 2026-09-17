import type { EcosystemAdapter } from "./ecosystems.js";
import type { PairRunner } from "./engine.js";
import { runInDocker, type SandboxMount } from "./sandbox.js";
import type { CandidateArtifact, CommandResult, DownstreamSpec, Execution } from "./types.js";

export interface LocalRunnerOptions {
  candidate: CandidateArtifact;
  adapter: EcosystemAdapter;
  image?: string;
  retries?: number;
}

export class DockerPairRunner implements PairRunner {
  constructor(private readonly options: LocalRunnerOptions) {}

  async runBaseline(workspace: string, spec: DownstreamSpec): Promise<Execution> {
    return this.execute(workspace, spec, false);
  }

  async runCandidate(workspace: string, spec: DownstreamSpec): Promise<Execution> {
    return this.execute(workspace, spec, true);
  }

  private async execute(workspace: string, spec: DownstreamSpec, candidate: boolean): Promise<Execution> {
    if (spec.services?.length) {
      throw new Error("Service-container orchestration is not available in the local runner yet; remove services or use a custom worker implementation.");
    }
    const requestedStrategy = spec.replacement;
    const actualStrategy = this.options.candidate.metadata.strategy;
    if (requestedStrategy && requestedStrategy !== "auto" && requestedStrategy !== actualStrategy) {
      throw new Error(`Replacement strategy ${requestedStrategy} is not supported by the ${this.options.adapter.id} adapter; use ${actualStrategy ?? "auto"}.`);
    }

    const resourceTimeout = spec.timeoutSeconds ?? spec.resources?.timeoutSeconds;
    const resources = { ...spec.resources, ...(resourceTimeout ? { timeoutSeconds: resourceTimeout } : {}) };
    const image = this.options.image ?? "downstreamci/runner:local";
    const network = spec.network?.mode ?? "none";
    const env = spec.env ?? {};
    const mounts: SandboxMount[] = candidate
      ? [{ source: this.options.candidate.path, target: "/candidate", readOnly: true }]
      : [];

    const runtime = await probeRuntime(image, workspace, spec, mounts, resources);
    if (runtime.failure) return failedSetup(runtime.failure, runtime.environment);

    const setup = spec.setup
      ? await runInDocker({ image, workspace, command: spec.setup, env, network, resources, mounts, kind: "setup" })
      : undefined;
    if (setup && setup.exitCode !== 0) return failedSetup(setup, runtime.environment);

    if (candidate) {
      const injection = await this.options.adapter.injectionCommands(this.options.candidate, "/candidate");
      const injected = await runInDocker({
        image,
        workspace,
        command: injection.join(" && "),
        env,
        network,
        resources,
        mounts,
        kind: "setup",
      });
      if (injected.exitCode !== 0) return failedSetup(injected, runtime.environment);
    }

    const command = [spec.build, spec.test].filter(Boolean).join(" && ");
    const attempts: CommandResult[] = [];
    for (let attempt = 0; attempt < (this.options.retries ?? 1); attempt += 1) {
      attempts.push(await runInDocker({ image, workspace, command, env, network, resources, mounts, kind: "test" }));
    }
    const test = attempts.at(-1);
    if (!test) throw new Error("runner produced no test attempt");
    return { ...(setup ? { setup } : {}), test, attempts, environment: runtime.environment };
  }
}

async function probeRuntime(
  image: string,
  workspace: string,
  spec: DownstreamSpec,
  mounts: SandboxMount[],
  resources: DownstreamSpec["resources"],
): Promise<{ environment: Record<string, string>; failure?: CommandResult }> {
  if (!spec.runtime || Object.keys(spec.runtime).length === 0) return { environment: {} };
  const commands: Record<string, string> = {
    node: 'node -p "process.versions.node"',
    python: 'python -c "import platform; print(platform.python_version())"',
    rust: "rustc --version | awk '{print $2}'",
    go: "go env GOVERSION | sed 's/^go//'",
  };
  const requested = Object.keys(spec.runtime);
  const unknown = requested.filter((key) => !commands[key]);
  if (unknown.length) throw new Error(`Unsupported runtime keys: ${unknown.join(", ")}. Supported keys: node, python, rust, go.`);
  const command = requested.map((key) => `printf '${key}='; ${commands[key]}`).join("; ");
  const result = await runInDocker({ image, workspace, command, network: "none", resources, mounts, kind: "setup" });
  if (result.exitCode !== 0) return { environment: {}, failure: result };
  const environment = Object.fromEntries(
    result.stdout.split("\n").map((line) => line.trim()).filter(Boolean).map((line) => {
      const index = line.indexOf("=");
      return index === -1 ? [line, ""] : [line.slice(0, index), line.slice(index + 1)];
    }),
  );
  for (const [key, expected] of Object.entries(spec.runtime)) {
    const actual = environment[key] ?? "";
    if (!(actual === expected || actual.startsWith(`${expected}.`))) {
      return {
        environment,
        failure: {
          command: `runtime check ${key}`,
          exitCode: 1,
          stdout: `${key}=${actual}`,
          stderr: `Requested ${key} runtime ${expected}, but runner image provides ${actual || "unknown"}.`,
          durationMs: result.durationMs,
          timedOut: false,
          kind: "setup",
        },
      };
    }
  }
  return { environment };
}

function failedSetup(setup: CommandResult, environment: Record<string, string>): Execution {
  const failure = { ...setup, kind: "setup" as const };
  return { setup: failure, test: failure, attempts: [failure], environment };
}
