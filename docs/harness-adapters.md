# Coding-agent harness adapters

Harnesses receive evidence only after deterministic comparison has identified a candidate-only failure. Their output is labeled `ANALYSIS` and cannot decide CI pass/fail.

The initial adapter research was performed against public upstream repositories on 2026-09-17.

| Harness | Upstream | Automated mode |
|---|---|---|
| Codex | `openai/codex` | `codex exec --experimental-json` JSONL |
| Claude Code | `anthropics/claude-code` | print mode with stream JSON |
| OpenCode | `anomalyco/opencode` | `opencode run --format json` |
| Pi | `earendil-works/pi` | `pi --mode json -p` |
| Gemini CLI | `google-gemini/gemini-cli` | `-p` with `--output-format stream-json` |
| Aider | `Aider-AI/aider` | `--message ... --yes --no-auto-commits` |
| Goose | `aaif-goose/goose` | `goose run --text` |
| Cline | `cline/cline` | headless CLI with `--json`; DownstreamCI leaves auto-approval off |
| Roo Code | `RooCodeInc/Roo-Code` | no verified stable headless CLI; automated invocation disabled |
| Continue | `continuedev/continue` | `cn -p ... --format json` |

Repository ownership can move. Capability metadata is explicit so a release can update invocation without changing the analysis contract.

## Prompt contract

The harness receives the upstream diff, candidate artifact metadata, baseline and candidate logs, relevant dependency manifest, runtime information, and downstream files selected by the coordinator. The prompt explicitly tells the harness that deterministic CI already owns pass/fail.
