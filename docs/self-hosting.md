# Self-hosting

## Single machine

Requirements:

- Node.js 22 or newer
- pnpm via Corepack
- Git
- Docker or a compatible hardened container runtime

```bash
corepack enable
pnpm install
pnpm runner:build
pnpm build
pnpm check
```

`downstreamci run .` defaults to the locally built `downstreamci/runner:local` image. Override it with `--runner-image` when publishing your own reviewed runner image.

Run the worker and GitHub service behind an authenticated reverse proxy. Set `DOWNSTREAMCI_WORKSPACE_ROOT` for workers; requests outside that real filesystem root are rejected.

## Storage

Local mode uses SQLite. The GitHub service exposes read-only recent-run data at `/api/runs/latest` for the React dashboard. Set `DOWNSTREAMCI_DB` when the database is not at `.downstreamci/downstreamci.db`.

Distributed mode should use a PostgreSQL-backed `RunStore` implementation and external artifact storage.

## Workers

Horizontal workers should consume immutable job specifications containing the downstream repository/ref, candidate identity, commands, resource policy, and network policy. GitHub credentials stay with the coordinator.
