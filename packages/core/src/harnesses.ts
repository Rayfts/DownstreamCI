import type { HarnessCapability, HarnessInvocation } from "./types.js";

function invocation(command: string, args: string[], output: HarnessInvocation["output"]): HarnessInvocation {
  return { command, args, output };
}

export const harnesses: HarnessCapability[] = [
  { id: "codex", displayName: "OpenAI Codex", upstream: "openai/codex", automated: true, structuredOutput: true, notes: "Uses codex exec JSONL mode verified in the upstream SDK.", buildInvocation: (prompt) => invocation("codex", ["exec", "--experimental-json", prompt], "jsonl") },
  { id: "claude-code", displayName: "Claude Code", upstream: "anthropics/claude-code", automated: true, structuredOutput: true, notes: "Uses print mode with stream-json output.", buildInvocation: (prompt) => invocation("claude", ["--print", "--output-format", "stream-json", prompt], "jsonl") },
  { id: "opencode", displayName: "OpenCode", upstream: "anomalyco/opencode", automated: true, structuredOutput: true, notes: "Uses the run command with JSON formatting.", buildInvocation: (prompt) => invocation("opencode", ["run", "--format", "json", prompt], "jsonl") },
  { id: "pi", displayName: "Pi", upstream: "earendil-works/pi", automated: true, structuredOutput: true, notes: "Uses Pi print mode and its documented JSON event stream.", buildInvocation: (prompt) => invocation("pi", ["--mode", "json", "-p", prompt], "jsonl") },
  { id: "gemini", displayName: "Gemini CLI", upstream: "google-gemini/gemini-cli", automated: true, structuredOutput: true, notes: "Uses documented headless prompt mode with stream-json output.", buildInvocation: (prompt) => invocation("gemini", ["-p", prompt, "--output-format", "stream-json"], "jsonl") },
  { id: "aider", displayName: "Aider", upstream: "Aider-AI/aider", automated: true, structuredOutput: false, notes: "Uses documented single-message scripting mode; text output is captured as analysis.", buildInvocation: (prompt) => invocation("aider", ["--message", prompt, "--yes", "--no-auto-commits"], "text") },
  { id: "goose", displayName: "Goose", upstream: "aaif-goose/goose", automated: true, structuredOutput: false, notes: "Uses documented non-interactive goose run --text mode.", buildInvocation: (prompt) => invocation("goose", ["run", "--text", prompt], "text") },
  { id: "cline", displayName: "Cline", upstream: "cline/cline", automated: true, structuredOutput: true, notes: "Uses documented headless JSON mode. DownstreamCI does not auto-enable tool approvals.", buildInvocation: (prompt) => invocation("cline", ["--json", "--auto-approve", "false", prompt], "jsonl") },
  { id: "roo-code", displayName: "Roo Code", upstream: "RooCodeInc/Roo-Code", automated: false, structuredOutput: false, notes: "No stable headless CLI was verified in the researched upstream repository; automated invocation is intentionally disabled.", buildInvocation: () => null },
  { id: "continue", displayName: "Continue", upstream: "continuedev/continue", automated: true, structuredOutput: true, notes: "Uses documented cn -p headless mode with structured JSON output.", buildInvocation: (prompt) => invocation("cn", ["-p", prompt, "--format", "json"], "json") },
];

export function getHarness(id: string): HarnessCapability {
  const harness = harnesses.find((candidate) => candidate.id === id);
  if (!harness) throw new Error(`Unknown harness: ${id}`);
  return harness;
}
