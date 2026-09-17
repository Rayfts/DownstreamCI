# GitHub App

DownstreamCI publishes a Check named `DownstreamCI / compatibility` and keeps GitHub credentials in the coordinator boundary, never inside arbitrary downstream containers.

## Authentication

`apps/github-app` supports either:

- `GITHUB_TOKEN` for local/operator-managed deployments, or
- installation-scoped GitHub App authentication using `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, and the webhook installation ID.

The App path creates a short-lived RS256 JWT, exchanges it for an installation access token, then uses that token for Checks API calls.

## Webhooks

`POST /webhooks/github` verifies `X-Hub-Signature-256` using `GITHUB_WEBHOOK_SECRET`. Pull-request actions `opened`, `reopened`, `synchronize`, and `ready_for_review` are normalized into a coordinator trigger containing repository, PR number, head SHA, and installation ID.

The included service deliberately does **not** execute untrusted repositories in the webhook process. Deployments enqueue that normalized trigger to a coordinator/worker boundary, then submit completed comparisons to `POST /internal/checks`.

## Check result

The check conclusion comes only from deterministic comparison. Optional coding-agent output is rendered as `ANALYSIS` and cannot change pass/fail state.

Minimum permissions should be repository/content/metadata read plus Checks write. Protect the internal check endpoint with service-to-service authentication or a private network/reverse proxy.
