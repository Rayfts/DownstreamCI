# Architecture

DownstreamCI separates deterministic execution from semantic analysis.

## Local-first data flow

1. Parse and validate `.downstreamci.yml`.
2. Resolve the upstream package identity and candidate strategy.
3. Create two independent downstream checkouts at the same exact ref.
4. Verify requested runtime versions in the reviewed runner image.
5. Provision the baseline checkout and run build/test attempts.
6. Provision the candidate checkout independently.
7. Mount upstream candidate source read-only at `/candidate` and apply the ecosystem-specific replacement strategy.
8. Run the same build/test attempts under the same resource/network policy.
9. Compare baseline and candidate deterministically.
10. Normalize failure signatures and detect flakiness from repeated attempts.
11. Only for `newly-broken`, optionally invoke a selected coding-agent harness in a disposable analysis directory.
12. Persist the run to SQLite and render CLI/GitHub/dashboard views.

## Trust boundaries

`packages/core` owns deterministic classification. Harness output is attached data labeled `ANALYSIS`; it cannot mutate classification.

`apps/worker` is the execution boundary and refuses workspaces outside `DOWNSTREAMCI_WORKSPACE_ROOT`.

`apps/github-app` owns GitHub credentials, webhook verification, Check publication, and read-only dashboard data. It does not run untrusted repositories in the webhook process.

The generic test container receives only explicitly selected environment variables. GitHub credentials remain with the coordinator/service layer.

## Scaling

The first release stores run history locally in SQLite. A distributed deployment can replace the store with PostgreSQL, put immutable jobs on a queue, and move logs/artifacts to object storage without changing the comparison contract.

Service containers are intentionally left to custom/distributed workers in the current local runner; configuring them fails closed rather than being ignored.
