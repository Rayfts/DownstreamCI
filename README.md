# DownstreamCI

**Reverse-dependency CI for open-source libraries, frameworks, SDKs, compilers, CLIs, and plugin systems.**

DownstreamCI answers the question ordinary repository CI cannot:

> This pull request passes our own tests, but will it break real projects that depend on us?

For every maintainer-approved downstream project, DownstreamCI executes the same pinned revision twice:

1. **BASELINE** — the downstream against its ordinary/current upstream dependency.
2. **CANDIDATE** — an independent clone of that downstream with the upstream pull-request candidate injected.

Only a baseline pass followed by a candidate failure is classified as `newly-broken`. A project that already fails at baseline is never promoted to a regression.

## What is implemented

The current tree provides a local-first production-oriented core:

- strict TypeScript monorepo
- versioned `.downstreamci.yml` validation
- deterministic baseline/candidate classifier
- repeated-attempt flake detection
- normalized failure signatures
- Docker sandbox with CPU/memory/PID/time limits, read-only root filesystem, bounded logs, and network disabled by default
- independent baseline and candidate checkouts
- npm, Python, Cargo, and Go candidate-injection adapters
- runtime-version verification for Node, Python, Rust, and Go when requested
- ten coding-agent capability adapters with verified automation only where an upstream mechanism was found
- SQLite run history
- CLI, worker API, GitHub Check publisher/webhook intake, and React dashboard
- suggestion-only GitHub downstream discovery
- deterministic fixtures and CI/security/container-image checks

Distributed queues, PostgreSQL storage, object artifacts, and service-container orchestration are extension points; the first release does not require them for local operation.

## Quick start

```bash
corepack enable
pnpm install
pnpm runner:build
pnpm check
pnpm build

# from an upstream project containing .downstreamci.yml
downstreamci doctor
downstreamci harnesses
downstreamci capabilities codex
downstreamci run .
```

The local CLI defaults to the image built as `downstreamci/runner:local`. Use `--runner-image` to select a reviewed alternative.

## Configuration

```yaml
version: 1

downstreams:
  - repository: https://github.com/example/consumer.git
    ref: 6bb7b8c0d5d4e2c8f0d3b55a73d18a41996611a9
    ecosystem: auto
    setup: npm ci
    build: npm run build
    test: npm test
    timeoutSeconds: 900
    runtime:
      node: "24"
    replacement: npm-pack-local-tarball
    resources:
      cpus: 2
      memoryMb: 2048
      pids: 256
    network:
      mode: bridge
    tags: [representative]
    priority: high
```

Pin downstream refs for repeatability. `network: bridge` is an explicit opt-in; use `none` whenever setup/tests can run from vendored or cached dependencies. Runtime keys currently supported by the local runner are `node`, `python`, `rust`, and `go`.

`services` is reserved in the schema for distributed/custom workers but the built-in local runner fails closed if it is configured rather than silently ignoring it.

## Classifications

| Classification | Meaning |
|---|---|
| `unaffected` | baseline and candidate pass |
| `newly-broken` | baseline passes, candidate fails |
| `baseline-failing` | baseline already fails; never treated as a new regression |
| `flaky` | repeated attempts disagree |
| `infrastructure-failure` | timeout/runner failure prevents a trustworthy comparison |
| `setup-failure` | provisioning, runtime verification, or candidate injection fails |
| `improved` | baseline fails, candidate passes |
| `inconclusive` | reserved for evidence that cannot support a deterministic conclusion |

## Ecosystems

The adapter boundary is `EcosystemAdapter`.

- **npm** — packs candidate source to a local tarball and installs it into the disposable candidate checkout.
- **Python** — builds a wheel from read-only candidate source and force-installs it without dependency re-resolution; `.venv/bin/python` is used when present.
- **Cargo** — injects a local `[patch.crates-io]` entry and refreshes the selected package offline.
- **Go modules** — applies `go mod edit -replace` to the disposable candidate checkout.

See [`docs/ecosystem-adapters.md`](docs/ecosystem-adapters.md).

## Coding-agent analysis

Agents run only after deterministic CI has already found a candidate-only failure. They receive bounded evidence and return output labeled **ANALYSIS**; they cannot decide basic pass/fail.

Registered harnesses:

- OpenAI Codex
- Claude Code
- OpenCode
- Pi
- Gemini CLI
- Aider
- Goose
- Cline
- Roo Code
- Continue

Roo Code remains registered but automated invocation is disabled because the research pass did not verify a stable headless CLI in its upstream repository. DownstreamCI does not invent one.

## CLI

```text
downstreamci run .
downstreamci run . --harness codex --json
downstreamci baseline <downstream>
downstreamci candidate <downstream>
downstreamci compare <run-id>
downstreamci test <downstream>
downstreamci discover . --limit 20
downstreamci doctor
downstreamci harnesses
downstreamci capabilities codex
```

`discover` uses GitHub code search to suggest repositories referencing the upstream package identity. Suggestions are non-blocking until a maintainer pins and adds them to `.downstreamci.yml`.

## Security model

Downstream repositories are untrusted code. The generic execution container receives no GitHub write token, SSH key, host Docker socket, or production credential. Candidate source is mounted read-only. Environment values are explicitly selected and omitted from command evidence; common token forms are redacted again before GitHub Check rendering.

Read [`SECURITY.md`](SECURITY.md) and [`docs/security.md`](docs/security.md) before running third-party code.

## GitHub integration

The Check name is `DownstreamCI / compatibility`.

`apps/github-app` verifies webhook signatures, normalizes relevant pull-request events, supports installation-scoped GitHub App credentials, publishes completed comparison results, and exposes recent stored runs to the dashboard. The webhook process intentionally does not execute arbitrary repository code; a coordinator/worker boundary owns execution.

See [`docs/github-app.md`](docs/github-app.md).

## Architecture

```text
apps/
  cli/          local operator UX
  github-app/   webhook intake, Checks API, read-only run API
  dashboard/    compatibility/history UI
  worker/       confined execution API
packages/
  core/         config, comparison, runner, adapters, storage, reporting
containers/
  runner/       reviewed multi-ecosystem execution image
fixtures/       deterministic compatibility cases
docs/           architecture/security/adapter/self-hosting documentation
```

See [`docs/architecture.md`](docs/architecture.md).

## License

Apache-2.0.
