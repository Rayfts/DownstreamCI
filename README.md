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
- hardened Docker sandbox: read-only root, dropped capabilities, no-new-privileges, bounded CPU/memory/PID/time, bounded logs, and network disabled by default
- optional isolated service containers on per-comparison Docker networks with no host ports
- Node ecosystem support for npm, pnpm, and Yarn
- Python support for pip, uv, and Poetry
- Rust Cargo and Go module candidate replacement
- reviewed multi-ecosystem runner image with pinned pnpm/Yarn/uv/Poetry tooling
- local sanitized/checksummed evidence bundles and SQLite run history
- optional PostgreSQL run history for distributed deployments
- historical signals for repeated regressions, flaky projects, clusters, ecosystems, and runtime versions
- CLI, reusable GitHub Action, GitHub App/Checks coordinator, authenticated durable job queue, worker service, and React/Vite dashboard
- trusted-base policy for both GitHub App and GitHub Action PR execution
- suggestion-only GitHub downstream discovery with deterministic ranking by dependency evidence, activity, adoption, popularity, and fork status
- ten coding-agent capability adapters with upstream provenance and no fabricated headless support

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
      - uses: Rayfts/DownstreamCI@<pinned-ref>
        with:
          config: .downstreamci.yml
          retries: "2"
```

Replace `<pinned-ref>` with a reviewed release tag or full commit SHA. On `pull_request`, the Action automatically loads `.downstreamci.yml` from the PR base SHA while testing candidate code from the checked-out PR. A PR therefore cannot grant itself network access, change the approved downstream set, or raise resource policy. `pull_request_target` is refused. For unusual trusted workflows, `policy-ref` can explicitly select the reviewed config revision.

For private downstream repositories, pass `github-token` explicitly. It is used only by host-side Git checkout and is not injected into downstream test containers. The Action does not require a proprietary DownstreamCI cloud service.

## Configuration

Copy `.downstreamci.example.yml` and pin downstream revisions for repeatability. If `setup` is omitted, the ecosystem adapter uses the detected package manager: npm/pnpm/Yarn, pip/uv/Poetry, Cargo, or Go modules. `network: none` is the secure default. Fresh dependency installation generally needs explicit `network: bridge` unless dependencies are already cached or vendored.

Configuration is bounded to 100 approved downstreams, eight service sidecars per downstream, at most 16 CPUs, 32 GiB RAM, 4,096 PIDs, and a two-hour command timeout. The sandbox clamps these limits again at runtime even when a programmatic caller bypasses YAML validation.

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

Registered harnesses: OpenAI Codex, Claude Code, OpenCode, Pi, Gemini CLI, Aider, Goose, Cline, Roo Code, and Continue. Each capability record stores the researched upstream repository, verification date, and evidence paths. Roo Code remains registered but automated invocation is disabled because no stable headless CLI was verified. Agents execute only after deterministic CI finds a candidate-only failure and their output is labeled `ANALYSIS`.

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

`apps/github-app` verifies GitHub webhooks, records candidate head repository/SHA plus trusted base SHA, creates a queued `DownstreamCI / compatibility` Check Run, and persists an execution job. Workers load policy from the base revision, heartbeat renewable leases, execute the same deterministic core pipeline, and can complete only while still owning the live lease.

GitHub installation credentials remain in the coordinator. A worker may receive a separately scoped **read-only** clone credential on the host; downstream containers receive neither GitHub credentials nor the Docker socket. The direct worker execution API is separately bearer-authenticated and fails closed when its token is absent.

Run history uses SQLite locally and PostgreSQL when `DOWNSTREAMCI_DATABASE_URL` or `DATABASE_URL` is configured. See [`docs/github-app.md`](docs/github-app.md), [`docs/security.md`](docs/security.md), and [`docs/self-hosting.md`](docs/self-hosting.md).

## Evidence and dashboard

Local runs write sanitized/checksummed evidence under `.downstreamci/artifacts/<run-id>/` and persist comparison history in `.downstreamci/downstreamci.db`. The dashboard shows the baseline/candidate matrix, failures, logs, agent analysis, runtime metadata, artifacts, failure clusters, and historical high-signal/flaky downstream data.

## Development

```bash
pnpm typecheck
pnpm test
pnpm fixtures:test
pnpm lint
pnpm build
docker build -t downstreamci/runner:ci containers/runner
```

CI exercises Node 22 and 24, tests, fixtures, lint/build, production dependency audit, secret-pattern scanning, the runner image/toolchain, a real Docker baseline/candidate comparison, and a live PostgreSQL integration test.

## License

Apache-2.0.
