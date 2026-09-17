import { clusterComparisons } from "./clustering.js";
import { detectEcosystem, ecosystemAdapter, type EcosystemAdapter } from "./ecosystems.js";
import { runComparison } from "./engine.js";
import { DockerPairRunner } from "./local-runner.js";
import type { Comparison, DownstreamConfig, DownstreamSpec } from "./types.js";

export interface PipelineOptions {
  runnerImage?: string;
  retries?: number;
}

export async function executeConfiguredPipeline(
  upstream: string,
  config: DownstreamConfig,
  options: PipelineOptions = {},
): Promise<Comparison[]> {
  const adapter = await resolveAdapterForConfig(upstream, config);
  const candidate = await adapter.buildCandidate(upstream);
  const runner = new DockerPairRunner({
    candidate,
    adapter,
    ...(options.runnerImage ? { image: options.runnerImage } : {}),
    retries: options.retries ?? 2,
  });
  const comparisons: Comparison[] = [];
  for (const spec of config.downstreams) {
    validateSpecEcosystem(spec, adapter);
    comparisons.push(await runComparison(spec, runner));
  }
  return clusterComparisons(comparisons);
}

export async function resolveAdapterForConfig(upstream: string, config: DownstreamConfig): Promise<EcosystemAdapter> {
  const explicit = new Set(config.downstreams.map((item) => item.ecosystem).filter((item) => item !== "auto"));
  if (explicit.size > 1) {
    throw new Error(`One upstream package cannot use multiple ecosystem adapters: ${[...explicit].join(", ")}`);
  }
  const id = [...explicit][0];
  return id ? ecosystemAdapter(id) : detectEcosystem(upstream);
}

export function validateSpecEcosystem(spec: DownstreamSpec, adapter: EcosystemAdapter): void {
  if (spec.ecosystem !== "auto" && spec.ecosystem !== adapter.id) {
    throw new Error(`${spec.repository} requests ${spec.ecosystem}, but the upstream candidate is ${adapter.id}`);
  }
}
