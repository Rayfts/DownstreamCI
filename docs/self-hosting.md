# Self-hosting

DownstreamCI has no mandatory hosted control plane.

## Single-machine CLI

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

Run `downstreamci run .` from an upstream repository containing `.downstreamci.yml`.

Local state defaults to:

- SQLite: `.downstreamci/downstreamci.db`
- artifacts: `.downstreamci/artifacts/<run-id>/`

## GitHub App coordinator

Build the monorepo, then run `apps/github-app` with `DOWNSTREAMCI_STANDALONE=1`.

Relevant environment variables:

- `GITHUB_WEBHOOK_SECRET` — required for webhook HMAC verification
- `GITHUB_APP_ID` + `GITHUB_APP_PRIVATE_KEY` — recommended installation-scoped App auth
- `GITHUB_TOKEN` — operator-managed alternative to App auth
- `DOWNSTREAMCI_INTERNAL_TOKEN` — required bearer token for coordinator `/internal/*`
- `DOWNSTREAMCI_DB` — SQLite path for local run history and coordinator jobs
- `DOWNSTREAMCI_DATABASE_URL` or `DATABASE_URL` — optional PostgreSQL run history
- `PORT` — defaults to 8787

The queue is durable SQLite with worker-owned renewable leases. PostgreSQL is used for run history when configured; queue state remains local to the coordinator instance.

## Distributed worker

Set:

- `DOWNSTREAMCI_COORDINATOR_URL`
- `DOWNSTREAMCI_INTERNAL_TOKEN`
- `DOWNSTREAMCI_WORKSPACE_ROOT`
- optional `DOWNSTREAMCI_WORKER_ID`
- optional `DOWNSTREAMCI_RUNNER_IMAGE`
- optional `DOWNSTREAMCI_RETRIES` (1-10)
- optional `DOWNSTREAMCI_POLL_MS`
- optional `DOWNSTREAMCI_LEASE_SECONDS` (120-3600; default 900)
- optional host-only `DOWNSTREAMCI_GITHUB_READ_TOKEN` for private GitHub clones
- `DOWNSTREAMCI_WORKER_TOKEN` if the direct `/v1/execute` API is enabled/used

Start the worker with `DOWNSTREAMCI_COORDINATOR=1 DOWNSTREAMCI_STANDALONE=1` after building the app. Multiple workers can poll one coordinator. Active workers heartbeat their leases, expired leases can be reclaimed, and completion is rejected when the submitting worker no longer owns the live lease.

The coordinator mode does not use `/v1/execute`; that endpoint exists for trusted direct orchestration integrations. It fails closed when `DOWNSTREAMCI_WORKER_TOKEN` is absent and otherwise requires that bearer token. Keep the worker service private behind a firewall/private network.

`DOWNSTREAMCI_WORKSPACE_ROOT` is enforced by the direct worker execution API. Resolved requested paths outside that filesystem root are rejected.

## Runner image

The bundled runner includes Node/npm/Corepack, pinned pnpm/Yarn, Python/pip/build, pinned uv/Poetry, Cargo/Rust, Go, Git, and build tooling. CI builds the image and checks each tool is executable.

Pin/review your production runner image rather than allowing untrusted downstreams to select arbitrary privileged images.

## Service containers

Configured sidecars run on a unique Docker network with no host ports. They are capability-dropped, resource-bounded, no-new-privileges, and read-only by default. Use `tmpfs` for writable service data where possible. `network: bridge` explicitly allows external egress for the per-comparison network; otherwise Docker creates it as an internal network.

## Storage and artifacts

SQLite is the simplest local deployment. PostgreSQL provides distributed run history. Local CLI artifacts are sanitized and checksummed; object storage is an extension point rather than a required service.

The dashboard reads `/api/runs/latest` and `/api/signals` from the GitHub service.
