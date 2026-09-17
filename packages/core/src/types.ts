export const classifications = [
  "unaffected",
  "newly-broken",
  "baseline-failing",
  "flaky",
  "infrastructure-failure",
  "setup-failure",
  "improved",
  "inconclusive",
] as const;

export type Classification = (typeof classifications)[number];
export type Ecosystem = "npm" | "python" | "cargo" | "go";

export interface CommandResult {
  command: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
  kind?: "test" | "setup" | "infrastructure";
}

export interface Execution {
  setup?: CommandResult;
  test: CommandResult;
  attempts: CommandResult[];
  environment: Record<string, string>;
}

export interface ArtifactReference {
  kind: "baseline-log" | "candidate-log" | "comparison";
  path: string;
  sha256: string;
  bytes: number;
}

export interface FailureCluster {
  id: string;
  fingerprint: string;
  label: string;
  members: number;
}

export interface Comparison {
  downstream?: {
    repository: string;
    ref: string;
    ecosystem?: Ecosystem | "auto";
    tags?: string[];
    priority?: "low" | "normal" | "high";
  };
  analysis?: { harness: string; raw: string; label: "ANALYSIS" };
  classification: Classification;
  confidence?: number;
  cluster?: FailureCluster;
  artifacts?: ArtifactReference[];
  baseline: Execution;
  candidate: Execution;
  baselineSignature?: string;
  candidateSignature?: string;
  reason: string;
}

export interface ResourceLimits {
  cpus: number;
  memoryMb: number;
  pids: number;
  timeoutSeconds: number;
}

export interface NetworkPolicy {
  mode: "none" | "bridge";
}

export interface ServiceSpec {
  name: string;
  image: string;
  env?: Record<string, string>;
  command?: string[];
  tmpfs?: string[];
  healthcheck?: string;
  healthTimeoutSeconds?: number;
  port?: number;
  memoryMb?: number;
  pids?: number;
  readOnly?: boolean;
}

export interface DownstreamSpec {
  repository: string;
  ref: string;
  ecosystem: Ecosystem | "auto";
  setup?: string;
  build?: string;
  test: string;
  timeoutSeconds?: number;
  runtime?: Record<string, string>;
  replacement?: string;
  services?: Array<string | ServiceSpec>;
  resources?: Partial<ResourceLimits>;
  network?: NetworkPolicy;
  env?: Record<string, string>;
  tags?: string[];
  expectedFlakyTests?: string[];
  priority?: "low" | "normal" | "high";
}

export interface DownstreamConfig {
  version: 1;
  downstreams: DownstreamSpec[];
}

export interface CandidateArtifact {
  ecosystem: Ecosystem;
  identity: string;
  path: string;
  metadata: Record<string, string>;
}

export interface HarnessInvocation {
  command: string;
  args: string[];
  output: "text" | "json" | "jsonl";
}

export interface HarnessCapability {
  id: string;
  displayName: string;
  upstream: string;
  automated: boolean;
  structuredOutput: boolean;
  notes: string;
  buildInvocation(prompt: string): HarnessInvocation | null;
}
