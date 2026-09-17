# Evidence artifacts

DownstreamCI keeps evidence useful without making raw downstream output a secret archive.

## Local CLI artifacts

`downstreamci run` writes one bundle per run under:

```text
.downstreamci/artifacts/<run-id>/
```

Each downstream bundle contains:

- `baseline.log`
- `candidate.log`
- `comparison.json`

The run directory also contains `manifest.json`. Log content is bounded and passed through the same credential redaction used by Check/report persistence. Every referenced artifact carries a SHA-256 checksum and byte count.

When `--harness` is selected and candidate-only failures exist, optional semantic cluster analysis is written as:

```text
semantic-clusters-<harness>.txt
```

That file is `ANALYSIS`; it is not a deterministic CI artifact and cannot alter the verdict.

## GitHub App / distributed artifacts

The coordinator creates the same deterministic artifact bundle from worker comparisons before publishing the final GitHub Check and before persisting run history.

Configure the artifact directory with:

```text
DOWNSTREAMCI_ARTIFACT_ROOT=/var/lib/downstreamci/artifacts
```

Local HTTP artifact serving is **disabled by default**. To expose coordinator-hosted links in GitHub Checks, configure both:

```text
DOWNSTREAMCI_SERVE_ARTIFACTS=1
DOWNSTREAMCI_PUBLIC_URL=https://downstreamci.example.com
```

With both values present, Check artifact references become links under `/api/artifacts/...`. Artifact path segments are validated and resolved inside the configured root; traversal and unknown filenames are rejected.

## Access control

Artifact logs are sanitized, but they can still contain proprietary source/test information. Enabling `DOWNSTREAMCI_SERVE_ARTIFACTS=1` is an explicit deployment decision, not a safe-public default.

For private repositories, put the coordinator/dashboard/artifact endpoints behind the organization's reverse proxy, VPN, identity-aware proxy, or equivalent access-control layer. `DOWNSTREAMCI_PUBLIC_URL` should point at that protected origin.

Do not embed long-lived bearer tokens in artifact URLs. The coordinator's `/internal/*` bearer token and direct worker token are separate control-plane credentials and must never be placed in links.

## External/object storage

The artifact contract stores portable relative paths, hashes, sizes, and optional URLs. A deployment may mirror the artifact root to S3-compatible or other object storage and rewrite URLs in a deployment-specific layer without changing deterministic comparison semantics. DownstreamCI does not require object storage for local or single-coordinator operation.
