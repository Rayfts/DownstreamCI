# Ecosystem adapters

Each adapter detects package identity, describes the upstream candidate, injects candidate source into a disposable downstream checkout, and reports its replacement strategy.

Candidate source is mounted read-only at `/candidate`; downstream mutation happens only in the disposable candidate checkout.

## npm

Strategy: `npm-pack-local-tarball`.

The candidate is packed with `npm pack`, then the resulting tarball is installed with `npm install --no-save --ignore-scripts`. The downstream's ordinary setup command remains responsible for creating its normal dependency tree first.

This initial adapter intentionally favors deterministic local-tarball replacement over package-manager-specific lockfile rewriting. pnpm/yarn consumers can still be tested when their setup produces a Node-compatible dependency tree, but projects requiring manager-specific override semantics should use a custom adapter until those strategies are implemented explicitly.

## Python

Strategy: `wheel-force-reinstall`.

The runner builds a wheel with `python -m build` and installs it with `pip install --force-reinstall --no-deps`. If the downstream setup created `.venv/bin/python`, candidate installation targets that interpreter.

## Cargo

Strategy: `cargo-patch-local-path`.

The candidate checkout receives or updates a `[patch.crates-io]` entry pointing to `/candidate`, then runs `cargo update -p <package> --offline`. Patch mutation occurs only in the disposable downstream clone.

## Go

Strategy: `go-mod-replace`.

The adapter reads the module path from `go.mod` and executes `go mod edit -replace=<module>=/candidate`.

## Future adapters

The interface is intentionally small enough for Maven, Gradle, NuGet, RubyGems, Composer, and Swift Package Manager. New strategies should be evidence-backed and must not silently fall back to a different replacement mechanism.
