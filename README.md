# DownstreamCI

**Deterministic reverse-dependency CI for libraries, frameworks, SDKs, compilers, CLIs, and plugin systems.**

Ordinary CI answers whether an upstream repository passes its own tests. DownstreamCI answers a different question:

> If this upstream change ships, which real projects that depend on it break?

For every maintainer-approved downstream revision, DownstreamCI creates two independent checkouts and executes the same build/test policy twice:

1. **BASELINE** — the downstream with its ordinary/current dependency graph.
2. **CANDIDATE** — the same downstream revision with the exact upstream candidate injected.

Only a baseline pass followed by a candidate failure is `newly-broken`. Pre-existing downstream failures are never promoted to regressions. Coding agents may analyze a candidate-only failure after that deterministic decision, but agent output is always labeled **ANALYSIS** and cannot change the verdict.

## Implemented architecture

- strict TypeScript/pnpm monorepo with Zod config validation
- deterministic baseline/candidate classifier with repeated-attempt flake detection
- maintainer-declared expected-flake matching, normalized signatures, confidence, and deterministic failure clusters
- independent baseline/candidate checkouts at the same pinned downstream ref
- hardened Docker sandbox: read-only root, dropped capabilities, no-new-privileges, CPU/memory/PID/time limits, bounded logs, and network disabled by default
- optional isolated service containers on per-comparison Docker networks with no host ports
- Node ecosystem support for npm, pnpm, and Yarn
- Python support for pip, uv, and Poetry
- Rust Cargo and Go module candidate replacement
- reviewed multi-ecosystem runner image with pinned pnpm/Yarn/uv/Poetry tooling
- local sanitized/checksummed evidence bundles and SQLite run history
- optional PostgreSQL run history for distributed deployments
- historical signals for repeated regressions, flaky projects, clusters, ecosystems, and runtime versions
- CLI, reusable GitHub Action, GitHub App/Checks coordinator, authenticated durable job queue, worker service, and React/Vite dashboard
- suggestion-only GitHub downstream discovery with deterministic ranking by dependency evidence, activity, adoption, popularity, and fork status
- ten coding-agent capability adapters with upstream provenance and no fabricated headless support
- fixtures/tests for candidate-only breaks, pre-existing failures, ecosystem strategies, artifacts, clustering, storage, queueing, worker confinement, reporting, and harness contracts

## Quick start

```bash
corepack enable
pnpm install
pnpm runner:build
pnpm check
pnpm build

# inside an upstream project containing .downstreamci.yml
downstreamci doctor
downstreamci run .
downstreamci signals
downstreamci discover . --limit 20
```

The CLI defaults to the reviewed image name `downstreamci/runner:local`. Build it with `pnpm runner:build` or select a reviewed alternative with `--runner-image`.

## GitHub Action

The repository includes a composite `action.yml`, so an upstream project can run the same local-first engine directly in GitHub Actions:

```yaml
name: Downstream compatibility
on:
  pull_request:

permissions:
  contents: read

jobs:
  downstream:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: Rayfts/DownstreamCI@v1
        with:
          config: .downstreamci.yml
          retries: "2"
```

For private downstream repositories, pass `github-token` explicitly. It is used only by host-side Git checkout and is not injected into downstream test containers. The Action does not require a proprietary DownstreamCI cloud service.

## Configuration

Copy `.downstreamci.example.yml` and pin downstream revisions for repeatability:

```yaml
version: 1

downstreams:
  - repository: https://github.com/example/consumer.git
    ref: 6bb7b8c0d5d4e2c8f0d3b55a73d18a41996611a9
    ecosystem: auto
    build: npm run build
    test: npm test
    timeoutSeconds: 900
    runtime:
      node: "24"
    replacement: auto
    resources:
      cpus: 2
      memoryMb: 2048
      pids: 256
    network:
      mode: bridge
    tags: [representative]
    priority: high
    expectedFlakyTests: []
```

If `setup` is omitted, the ecosystem adapter uses the detected package manager: npm/pnpm/Yarn, pip/uv/Poetry, Cargo, or Go modules. `network: none` is the secure default. Fresh dependency installation generally needs explicit `network: bridge` unless dependencies are already cached or vendored.

Services can be declared by image name or as structured sidecars with a name, image, environment, optional command/tmpfs/health check/port metadata, and resource bounds. They receive no host port mapping. Without `network: bridge`, the per-run service network is Docker-internal and has no external egress.

## Classification model

| Classification | Meaning |
|---|---|
| `unaffected` | baseline and candidate pass |
| `newly-broken` | baseline passes, candidate fails |
| `baseline-failing` | baseline already fails; never treated as a new regression |
| `flaky` | repeated attempts disagree, or a failure matches explicit maintainer-declared flaky evidence |
| `infrastructure-failure` | timeout/runner failure prevents a trustworthy comparison |
| `setup-failure` | provisioning, runtime verification, service startup, or candidate injection fails |
| `improved` | baseline fails, candidate passes |
| `inconclusive` | evidence cannot support a deterministic conclusion |

The GitHub Check fails only for `newly-broken`; incomplete coverage is reported as neutral rather than a false green.

## Ecosystems

`EcosystemAdapter` keeps the control plane neutral and extensible.

- **npm/pnpm/Yarn** — pack the upstream candidate to a local tarball, then install it with the downstream's detected Node package manager.
- **pip/uv/Poetry** — build an upstream wheel and force-reinstall it without dependency re-resolution into the downstream environment.
- **Cargo** — inject a local `[patch.crates-io]` path and refresh the selected package offline after normal dependency setup.
- **Go modules** — apply a local `go mod edit -replace` directive.

The adapter boundary is intentionally suitable for Maven/Gradle, NuGet, RubyGems, Composer, and SwiftPM without coupling the deterministic comparison model to one ecosystem.

See [`docs/ecosystem-adapters.md`](docs/ecosystem-adapters.md).

## Coding-agent analysis

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

Each capability record stores the researched upstream repository, verification date, and evidence paths. Roo Code remains registered but automated invocation is disabled because no stable headless CLI was verified. DownstreamCI does not invent one.

Agents execute only after deterministic CI finds a candidate-only failure. They receive bounded evidence in a disposable analysis directory and return output labeled `ANALYSIS`.

See [`docs/harness-adapters.md`](docs/harness-adapters.md).

## CLI

```text
downstreamci run .
downstreamci run . --harness codex --json
downstreamci baseline <downstream>
downstreamci candidate <downstream>
downstreamci test <downstream>
downstreamci compare <run-id>
downstreamci signals --limit 100
downstreamci discover . --limit 20
downstreamci doctor
downstreamci harnesses
downstreamci capabilities codex
```

`discover` searches GitHub for direct package-identity references, hydrates repository metadata, filters archived projects, and ranks suggestions. Discovery never changes the release-blocking set automatically; maintainers pin and approve downstreams in `.downstreamci.yml`.

## GitHub App and distributed workers

`apps/github-app` verifies GitHub webhooks, creates a queued `DownstreamCI / compatibility` Check Run, and persists an execution job. Authenticated workers claim leased jobs, check out the PR on the trusted host, execute the same deterministic core pipeline, and return comparisons. The coordinator then updates the original Check Run and persists history.

GitHub installation credentials remain in the coordinator. A worker may receive a separately scoped **read-only** clone credential on the host; downstream containers receive neither GitHub credentials nor the Docker socket.

Run history uses SQLite locally and PostgreSQL when `DOWNSTREAMCI_DATABASE_URL` or `DATABASE_URL` is configured. Queue state is local SQLite in the coordinator deployment. See [`docs/github-app.md`](docs/github-app.md) and [`docs/self-hosting.md`](docs/self-hosting.md).

## Evidence and dashboard

Local runs write sanitized/checksummed evidence under `.downstreamci/artifacts/<run-id>/` and persist comparison history in `.downstreamci/downstreamci.db`. The dashboard shows the baseline/candidate matrix, failures, logs, agent analysis, runtime metadata, artifacts, failure clusters, and historical high-signal/flaky downstream data.

GitHub Checks include counts, baseline/candidate outcomes, confidence, cluster/signature data, environment metadata, available artifact references, bounded sanitized logs, and optional `ANALYSIS` output.

## Security model

Downstream repositories are untrusted code. Generic execution containers receive no GitHub write token, SSH key, production credential, host Docker socket, or implicit secret. Candidate source is mounted read-only. Environment values are explicitly selected. Network access is disabled unless a downstream opts in. Common credential forms are redacted again before evidence publication.

Service containers are also capability-dropped and resource-bounded. Their image selection and any explicit environment values are part of maintainer-reviewed configuration.

Read [`SECURITY.md`](SECURITY.md) and [`docs/security.md`](docs/security.md) before running third-party code.

## Repository layout

```text
apps/
  cli/          local operator UX
  github-app/   webhook intake, durable queue, Checks API, run/signal API
  dashboard/    compatibility/history UI
  worker/       confined execution API and coordinator polling worker
packages/
  core/         config, classifier, runner, sandbox, adapters, storage, reporting, harnesses
containers/
  runner/       reviewed multi-ecosystem execution image
fixtures/       deterministic compatibility cases
docs/           architecture/security/ecosystem/harness/GitHub/self-hosting documentation
```

## Development

```bash
pnpm typecheck
pnpm test
pnpm fixtures:test
pnpm lint
pnpm build
docker build -t downstreamci/runner:ci containers/runner
```

CI exercises Node 22 and 24, tests, fixtures, lint/build, production dependency audit, secret-pattern scanning, and the runner image/toolchain.

## License

Apache-2.0.
