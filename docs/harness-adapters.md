# Coding-agent harness adapters

Harnesses receive evidence only after deterministic comparison has identified a candidate-only failure. Their output is labeled `ANALYSIS` and cannot decide CI pass/fail.

The capability registry was initially verified against the listed public upstream repositories on **2026-09-17**. Pi, Goose, and Cline provenance was re-checked on **2026-09-18** during an OSS-readiness audit. Each capability record includes the upstream repository and concrete evidence paths so invocation drift is reviewable.

| Harness | Upstream | Verified automated mode | Evidence in upstream |
|---|---|---|---|
| Codex | `openai/codex` | `codex exec --json` JSONL | `codex-rs/exec/src/cli.rs` |
| Claude Code | `anthropics/claude-code` | `--print --output-format stream-json` | `plugins/security-guidance/hooks/llm.py`, `feed.xml` |
| OpenCode | `anomalyco/opencode` | `opencode run --format json` | `packages/opencode/src/cli/cmd/run.ts` |
| Pi | `mitsuhiko/pi-mono` | `pi --mode json -p` | `packages/coding-agent/docs/usage.md`, `packages/coding-agent/docs/rpc.md` |
| Gemini CLI | `google-gemini/gemini-cli` | `-p` with `--output-format stream-json` | `README.md`, `docs/changelogs/index.md`, CLI config source |
| Aider | `Aider-AI/aider` | `--message ... --yes --no-auto-commits` | `aider/website/docs/scripting.md` |
| Goose | `aaif-goose/goose` | `goose run --output-format stream-json --no-session --text ...` | `documentation/docs/guides/running-tasks.md` |
| Cline | `cline/cline` | headless `--json`; auto-approval explicitly false | `apps/cli/README.md`, `apps/cli/src/main.ts` |
| Roo Code | `RooCodeInc/Roo-Code` | **disabled** — no verified stable headless CLI | reviewed repository README/package surfaces |
| Continue | `continuedev/continue` | `cn -p ... --format json` | `docs/cli/headless-mode.mdx`, `extensions/cli/src/index.ts` |

Repository ownership and CLIs can move. A capability change should update its evidence paths and contract tests in the same commit. DownstreamCI does not infer a new flag from another harness or silently enable undocumented behavior.

## Prompt contract

Per-failure analysis receives bounded upstream diff text, candidate metadata, baseline/candidate logs, dependency context, and runtime metadata. Credential-shaped values are redacted before the prompt reaches a harness. It runs in a disposable temporary analysis directory rather than either downstream checkout. The prompt explicitly states that deterministic CI already owns pass/fail and asks for evidence, uncertainty, and a semantic failure category.

DownstreamCI also exposes optional **semantic cluster analysis** over the already-deterministic failure clusters. The agent receives immutable cluster IDs and bounded/redacted evidence, and may suggest higher-level semantic families. This output remains `ANALYSIS`; it cannot merge deterministic clusters or change classifications, confidence, Check conclusions, or release-blocking facts.

## Harness environment isolation

Agent processes do not inherit the worker's complete environment or its normal user configuration. Each invocation gets a fresh temporary HOME/USERPROFILE/XDG config/cache/temp layout and a minimal platform environment. Supported model-provider credentials and settings are copied explicitly; additional harmless variables may be opted in with `DOWNSTREAMCI_AGENT_ENV_ALLOWLIST`.

Control-plane and infrastructure credentials remain blocked from agent subprocesses. Variables under `DOWNSTREAMCI_*`, `GITHUB_*`, `GH_TOKEN`, `AWS_*`, and password/private-key/secret-shaped names are not forwarded through the allowlist. This separation is independent of prompt redaction: secrets should not enter the harness environment in the first place.

Provider/harness authentication remains the operator's responsibility. Analysis is optional; the deterministic comparison works without any coding agent.
