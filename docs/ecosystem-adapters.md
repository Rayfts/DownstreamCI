# Ecosystem adapters

`EcosystemAdapter` keeps package-manager mechanics outside the deterministic comparison engine. Each adapter detects the upstream package identity, describes a candidate, provides ordinary downstream setup commands, and injects the candidate into a disposable candidate checkout.

Candidate source is mounted read-only at `/candidate`. Baseline and candidate use separate downstream clones, so no restoration step is required.

## Node: npm, pnpm, Yarn

Strategy: `node-manager-local-tarball`.

The adapter reads `packageManager` and lockfiles to choose pnpm, Yarn, or npm. Ordinary setup uses the manager's lock-preserving install mode where available:

- pnpm: `pnpm install --frozen-lockfile`
- Yarn 2+: `yarn install --immutable`
- Yarn 1: `yarn install --frozen-lockfile`
- npm with a lock: `npm ci`
- npm without a lock: `npm install`

For the candidate run, upstream source is packed with `npm pack`, then the local tarball is added with the downstream's detected manager. Candidate replacement disables package lifecycle scripts during the replacement step; the downstream's configured build/test commands still run normally afterward.

## Python: pip, uv, Poetry

Strategy: `python-wheel-manager-reinstall`.

Setup detects `uv.lock`, `poetry.lock`, `requirements.txt`, or a generic Python project:

- uv: `uv sync --frozen`
- Poetry: `poetry install --no-interaction --no-ansi`
- pip requirements: `python -m pip install -r requirements.txt`
- generic local project: editable pip install

The candidate is built as a wheel with `python -m build` and force-reinstalled without dependency re-resolution into the active environment. uv and Poetry use their own environment/interpreter paths where applicable.

## Rust Cargo

Strategy: `cargo-patch-local-path`.

The baseline setup fetches the locked dependency graph where a lockfile exists. Candidate injection adds or updates `[patch.crates-io]` for the upstream package, points it to `/candidate`, then refreshes that package offline. Mutation occurs only in the disposable candidate clone.

## Go modules

Strategy: `go-mod-replace`.

The baseline setup downloads modules. Candidate injection reads the upstream module path from `go.mod` and applies `go mod edit -replace=<module>=/candidate` in the disposable candidate checkout.

## Adapter invariants

A new adapter should:

1. detect package identity from source-of-truth ecosystem metadata;
2. provision the downstream's ordinary baseline dependency graph;
3. build/describe the exact upstream candidate;
4. replace only the target dependency in the candidate checkout;
5. avoid mutating the baseline checkout;
6. surface a named replacement strategy and deterministic metadata;
7. fail closed rather than silently falling back to an unrelated mechanism.

The interface is intentionally small enough for Maven/Gradle, NuGet, RubyGems, Composer, and SwiftPM adapters.
