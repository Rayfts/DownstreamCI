# GitHub integration

DownstreamCI supports two GitHub surfaces:

1. the reusable composite `action.yml` for projects that want compatibility testing directly inside GitHub Actions; and
2. `apps/github-app` for queued, distributed execution with a rich `DownstreamCI / compatibility` Check Run.

## GitHub App authentication

`apps/github-app` supports either:

- `GITHUB_TOKEN` for local/operator-managed deployments, or
- installation-scoped GitHub App authentication using `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, and the webhook installation ID.

The App creates a short-lived RS256 JWT, exchanges it for an installation access token, and uses that token for Checks API calls. GitHub credentials remain in the coordinator process.

## Webhooks and trusted policy

`POST /webhooks/github` verifies `X-Hub-Signature-256` using `GITHUB_WEBHOOK_SECRET`. Pull-request actions `opened`, `reopened`, `synchronize`, and `ready_for_review` trigger execution.

For an accepted PR, the service records both the candidate head repository/SHA and the base SHA. The worker checks out candidate source from the PR head repository, but loads `.downstreamci.yml` from the base repository at the trusted base SHA. A contributor therefore cannot expand the approved downstream set, enable network access, raise resource policy, or alter execution commands merely by changing `.downstreamci.yml` in the PR under test. A first-time configuration must be merged/reviewed before it can govern automatic PR execution.

The service then:

1. creates a queued `DownstreamCI / compatibility` Check Run;
2. persists a durable SQLite coordinator job containing base repository, candidate repository/head SHA, trusted base SHA, installation ID, and Check Run ID;
3. returns `202` without executing arbitrary repository code in the webhook process.

Workers authenticate with `Authorization: Bearer <DOWNSTREAMCI_INTERNAL_TOKEN>` and claim leased work at `POST /internal/jobs/claim`. While executing, the owning worker renews its lease through `POST /internal/jobs/:id/lease`. Completion is posted to `POST /internal/jobs/:id/complete` and is accepted only from the worker that still owns a live lease. Expired leases can be reclaimed by another worker without allowing the stale worker to publish a Check result afterward.

`POST /internal/checks` remains available for authenticated coordinator/operator publication of already-computed comparisons.

## Worker boundary

`apps/worker` coordinator mode polls the authenticated job endpoint, checks out candidate source on the trusted host, independently checks out the base revision for trusted configuration, and runs the shared core pipeline. Downstream setup/build/tests execute in the hardened Docker sandbox.

Long-running jobs heartbeat at roughly one third of their configured lease duration. `DOWNSTREAMCI_LEASE_SECONDS` defaults to 900 and is bounded to 120-3600 seconds.

Private clone access can use a separately scoped host-side `DOWNSTREAMCI_GITHUB_READ_TOKEN`. It is placed in a temporary Git home and is not forwarded into containers.

## Check result

The Check conclusion comes only from deterministic comparison. It renders classification counts, baseline/candidate matrix, confidence/signatures, deterministic clusters, runtime metadata, artifact references/checksums, bounded sanitized logs, and optional coding-agent output explicitly labeled `ANALYSIS`.

`newly-broken` produces failure. Coverage gaps such as baseline failures, flakes, setup failures, infrastructure failures, or inconclusive evidence produce a neutral Check rather than a false green.

## Run/history API

`GET /api/runs/latest?limit=N` serves recent stored runs. `GET /api/signals?limit=N` serves aggregated downstream/cluster/ecosystem/runtime history for the dashboard.

SQLite is the default run store. Configure `DOWNSTREAMCI_DATABASE_URL` or `DATABASE_URL` for PostgreSQL run history. The coordinator job queue remains SQLite-backed in the current implementation.

## Internal endpoint security

Set a high-entropy `DOWNSTREAMCI_INTERNAL_TOKEN` and expose `/internal/*` only to trusted workers/operators. Do not place this token in downstream configuration or container environment. Worker identity is also checked against the current job lease for renewal and completion.
