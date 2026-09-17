# CLI contract

DownstreamCI's CLI is local-first and does not require a hosted service.

## Commands

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

`run` executes every maintainer-approved downstream in `.downstreamci.yml`. `test` executes the full baseline/candidate comparison for one configured downstream. `baseline` and `candidate` are debugging surfaces for inspecting one side independently. `compare` reads a stored run. `signals` summarizes historical reliability. `discover` is suggestion-only and never changes the approved downstream set.

## Exit codes

`downstreamci run` and `downstreamci test` use deterministic conclusion exit codes:

- `0` — trustworthy result with no candidate-only regression.
- `2` — one or more `newly-broken` candidate-only regressions.
- `3` — neutral/incomplete evidence such as baseline failures, flakes, setup failures, infrastructure failures, inconclusive results, or an empty result set.

Other command/configuration/process failures use normal nonzero CLI failure semantics. This separation prevents incomplete evidence from looking like a green compatibility run while keeping a candidate regression distinguishable from infrastructure/coverage problems.

## Agent analysis

`--harness <id>` is optional. For each deterministic `newly-broken` result, DownstreamCI sends bounded, redacted evidence to the verified harness invocation and attaches the response as `ANALYSIS`.

After deterministic failure signatures have been clustered, the same selected harness may also produce optional semantic clustering. Semantic clustering receives immutable deterministic cluster IDs and may only suggest higher-level semantic families. It cannot change classification, confidence, cluster IDs, Check conclusions, or exit codes.

For machine consumers, `--json` includes a top-level `semanticClustering` field when semantic analysis was attempted. Human-readable runs also write:

```text
.downstreamci/artifacts/<run-id>/semantic-clusters-<harness>.txt
```

Agent evidence is sanitized before it reaches a harness; harness output is bounded/sanitized before it is printed or persisted.

## Evidence

Every `run` writes deterministic comparison evidence under `.downstreamci/artifacts/<run-id>/` and stores sanitized run history in `.downstreamci/downstreamci.db`. Use `compare` and `signals` to inspect the local history without re-running downstream code.
