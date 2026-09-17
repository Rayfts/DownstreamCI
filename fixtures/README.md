# Fixtures

Fixtures are deliberately tiny consumers used to prove the baseline/candidate contract without relying on public repositories.

The npm smoke fixture contains a `published-upstream` baseline and an `upstream-lib` candidate. `downstream-good` passes against the published baseline and fails after candidate injection. `downstream-baseline-failing` fails both before and after candidate injection, proving that a pre-existing failure must not be promoted to a regression.

Run:

```bash
pnpm fixtures:test
```

The Python, Rust, and Go directories provide minimal manifests for adapter-focused integration tests. Deterministic classification itself is unit-tested in `packages/core/test/compare.test.ts`.
