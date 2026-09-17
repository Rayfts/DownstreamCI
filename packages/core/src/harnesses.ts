import type { HarnessCapability, HarnessInvocation } from "./types.js";

function invocation(command: string, args: string[], output: HarnessInvocation["output"]): HarnessInvocation {
  return { command, args, output };
}

const verifiedAt = "2026-09-17";

export const harnesses: HarnessCapability[] = [
  {
    id: "codex",
    displayName: "OpenAI Codex",
    upstream: "openai/codex",
    automated: true,
    structuredOutput: true,
    verifiedAt,
    evidence: ["codex-rs/exec/src/cli.rs"],
    notes: "Uses the canonical codex exec --json JSONL mode; --experimental-json remains an upstream alias but is not used.",
    buildInvocation: (prompt) => invocation("codex", ["exec", "--json", prompt], "jsonl"),
  },
  {
    id: "claude-code",
    displayName: "Claude Code",
    upstream: "anthropics/claude-code",
    automated: true,
    structuredOutput: true,
    verifiedAt,
    evidence: ["plugins/security-guidance/hooks/llm.py", "feed.xml"],
    notes: "Uses documented print mode with stream-json output.",
    buildInvocation: (prompt) => invocation("claude", ["--print", "--output-format", "stream-json", prompt], "jsonl"),
  },
  {
    id: "opencode",
    displayName: "OpenCode",
    upstream: "anomalyco/opencode",
    automated: true,
    structuredOutput: true,
    verifiedAt,
    evidence: ["packages/opencode/src/cli/cmd/run.ts"],
    notes: "Uses the non-interactive run command with raw JSON event streaming.",
    buildInvocation: (prompt) => invocation("opencode", ["run", "--format", "json", prompt], "jsonl"),
  },
  {
    id: "pi",
    displayName: "Pi",
    upstream: "earendil-works/pi",
    automated: true,
    structuredOutput: true,
    verifiedAt,
    evidence: ["packages/coding-agent/docs/usage.md"],
    notes: "Uses print mode plus --mode json, which the upstream usage docs define as JSON-lines event output.",
    buildInvocation: (prompt) => invocation("pi", ["--mode", "json", "-p", prompt], "jsonl"),
  },
  {
    id: "gemini",
    displayName: "Gemini CLI",
    upstream: "google-gemini/gemini-cli",
    automated: true,
    structuredOutput: true,
    verifiedAt,
    evidence: ["README.md", "docs/changelogs/index.md", "packages/cli/src/config/config.ts"],
    notes: "Uses headless prompt mode with documented stream-json output.",
    buildInvocation: (prompt) => invocation("gemini", ["-p", prompt, "--output-format", "stream-json"], "jsonl"),
  },
  {
    id: "aider",
    displayName: "Aider",
    upstream: "Aider-AI/aider",
    automated: true,
    structuredOutput: false,
    verifiedAt,
    evidence: ["aider/website/docs/scripting.md"],
    notes: "Uses documented single-message scripting mode; auto-commits are disabled and text output is captured as analysis.",
    buildInvocation: (prompt) => invocation("aider", ["--message", prompt, "--yes", "--no-auto-commits"], "text"),
  },
  {
    id: "goose",
    displayName: "Goose",
    upstream: "aaif-goose/goose",
    automated: true,
    structuredOutput: false,
    verifiedAt,
    evidence: ["documentation/docs/tutorials/headless-goose.md", "documentation/docs/tutorials/goose-in-docker.md"],
    notes: "Uses the documented non-interactive goose run --text mode.",
    buildInvocation: (prompt) => invocation("goose", ["run", "--text", prompt], "text"),
  },
  {
    id: "cline",
    displayName: "Cline",
    upstream: "cline/cline",
    automated: true,
    structuredOutput: true,
    verifiedAt,
    evidence: ["docs/usage/cli-overview.mdx", "apps/cli/src/main.ts"],
    notes: "Uses the official headless CLI JSON mode. DownstreamCI explicitly leaves auto-approval disabled.",
    buildInvocation: (prompt) => invocation("cline", ["--json", "--auto-approve", "false", prompt], "jsonl"),
  },
  {
    id: "roo-code",
    displayName: "Roo Code",
    upstream: "RooCodeInc/Roo-Code",
    automated: false,
    structuredOutput: false,
    verifiedAt,
    evidence: ["README.md", "package.json"],
    notes: "No stable headless CLI was verified in the researched upstream repository; automated invocation is intentionally disabled.",
    buildInvocation: () => null,
  },
  {
    id: "continue",
    displayName: "Continue",
    upstream: "continuedev/continue",
    automated: true,
    structuredOutput: true,
    verifiedAt,
    evidence: ["docs/cli/headless-mode.mdx", "extensions/cli/src/index.ts"],
    notes: "Uses documented cn -p headless mode with --format json.",
    buildInvocation: (prompt) => invocation("cn", ["-p", prompt, "--format", "json"], "json"),
  },
];

export function getHarness(id: string): HarnessCapability {
  const harness = harnesses.find((candidate) => candidate.id === id);
  if (!harness) throw new Error(`Unknown harness: ${id}`);
  return harness;
}
