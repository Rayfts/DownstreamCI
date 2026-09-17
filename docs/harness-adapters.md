# Coding-agent harness adapters

Harnesses receive evidence only after deterministic comparison has identified a candidate-only failure. Their output is labeled `ANALYSIS` and cannot decide CI pass/fail.

The capability registry was re-verified against the listed public upstream repositories on **2026-09-17**. Each capability record includes the upstream repository and concrete evidence paths so invocation drift is reviewable.

| Harness | Upstream | Verified automated mode | Evidence in upstream |
|---|---|---|---|
| Codex | `openai/codex` | `codex exec --json` JSONL | `codex-rs/exec/src/cli.rs` |
| Claude Code | `anthropics/claude-code` | `--print --output-format stream-json` | `plugins/security-guidance/hooks/llm.py`, `feed.xml` |
| OpenCode | `anomalyco/opencode` | `opencode run --format json` | `packages/opencode/src/cli/cmd/run.ts` |
| Pi | `earendil-works/pi` | `pi --mode json -p` | `packages/coding-agent/docs/usage.md` |
| Gemini CLI | `google-gemini/gemini-cli` | `-p` with `--output-format stream-json` | `README.md`, `docs/changelogs/index.md`, CLI config source |
| Aider | `Aider-AI/aider` | `--message ... --yes --no-auto-commits` | `aider/website/docs/scripting.md` |
| Goose | `aaif-goose/goose` | `goose run --text` | headless/goose-in-docker tutorials |
| Cline | `cline/cline` | headless `--json`; auto-approval explicitly false | `docs/usage/cli-overview.mdx`, `apps/cli/src/main.ts` |
| Roo Code | `RooCodeInc/Roo-Code` | **disabled** — no verified stable headless CLI | reviewed repository README/package surfaces |
| Continue | `continuedev/continue` | `cn -p ... --format json` | `docs/cli/headless-mode.mdx`, `extensions/cli/src/index.ts` |

Repository ownership and CLIs can move. A capability change should update its evidence paths and contract tests in the same commit. DownstreamCI does not infer a new flag from another harness or silently enable undocumented behavior.

## Prompt contract

The analyzer receives bounded upstream diff text, candidate metadata, baseline/candidate logs, dependency context, and runtime metadata. It runs in a disposable temporary analysis directory rather than either downstream checkout. The prompt explicitly states that deterministic CI already owns pass/fail and asks for evidence, uncertainty, and a semantic failure category.

Provider/harness authentication remains the operator's responsibility. Analysis is optional; the deterministic comparison works without any coding agent.
