# Contributing to DownstreamCI

Thanks for helping improve DownstreamCI. Contributions are welcome across the deterministic comparison engine, ecosystem adapters, sandboxing, GitHub integration, workers, dashboard, harness analysis, fixtures, and documentation.

The core invariant is: **baseline and candidate execution determine compatibility; AI analysis never changes the verdict.**

## Development setup

Use the repository's pnpm workspace:

```bash
corepack enable
pnpm install
pnpm typecheck
pnpm test
pnpm fixtures:test
pnpm lint
pnpm build
```

Build the reviewed runner image when changing execution behavior:

```bash
pnpm runner:build
```

## Design rules

1. Baseline and candidate must use the same pinned downstream revision and equivalent test policy.
2. A pre-existing downstream failure must never become `newly-broken`.
3. Third-party repositories are untrusted code. Do not weaken container isolation or expose host credentials for convenience.
4. GitHub/App credentials belong to the coordinator/host side and must not leak into downstream containers.
5. Ecosystem adapters should use deterministic, reviewable candidate-injection mechanisms.
6. Agent output is labeled analysis and cannot mutate deterministic classifications.
7. Do not invent harness flags or capabilities; adapter claims require upstream source or official documentation.
8. Add fixture coverage for new classification, ecosystem, sandbox, or clustering behavior.

## Ecosystem adapters

New ecosystems should implement the existing adapter boundary rather than special-casing the core comparison model. Document detection, candidate build/injection, dependency installation, test execution, cleanup, and known limitations.

## Pull requests

Keep PRs focused. Include tests/fixtures, describe security implications, and note any changes to configuration, evidence format, or compatibility classification. Changes to worker/coordinator trust boundaries deserve explicit threat-model reasoning.

By contributing, you agree to follow `CODE_OF_CONDUCT.md` and the Apache-2.0 license terms.