# Architecture

DownstreamCI separates deterministic compatibility facts from optional semantic analysis.

## Local-first comparison flow

1. Parse and validate `.downstreamci.yml` with Zod.
2. Detect the upstream ecosystem and package identity.
3. Build the candidate descriptor and replacement strategy.
4. Create two independent downstream checkouts at the same pinned ref.
5. Start optional sidecar services on an isolated per-comparison Docker network.
6. Verify requested runtime versions in the reviewed runner image.
7. Provision and test the **baseline** checkout with its ordinary dependency graph.
8. Provision the **candidate** checkout independently.
9. Mount upstream candidate source read-only at `/candidate` and apply the ecosystem-specific replacement.
10. Run the same build/test attempts under equivalent resource/network/service policy.
11. Classify the result deterministically, apply explicit expected-flake policy, and normalize signatures.
12. Cluster candidate-only failures by stable normalized fingerprint.
13. Optionally invoke a selected coding-agent harness only for `newly-broken` evidence; output is labeled `ANALYSIS`.
14. Write sanitized/checksummed artifacts and persist run history.
15. Render CLI, GitHub Check, API, and dashboard views from the same comparison objects.

## GitHub coordinator flow

```text
GitHub pull_request webhook
        |
        v
apps/github-app
  verify HMAC signature
  create queued Check Run
  persist durable SQLite job
        |
        v
authenticated worker lease
        |
        v
apps/worker coordinator loop
  trusted-host PR checkout
  core deterministic pipeline
  untrusted downstreams in Docker
        |
        v
internal completion endpoint
  update original Check Run
  persist SQLite/PostgreSQL history
```

The webhook process never executes arbitrary repository code.

## Trust boundaries

`packages/core` owns classification. Harness output is attached data and cannot mutate pass/fail.

`apps/github-app` owns GitHub webhook verification, installation-scoped credentials, Check publication, the authenticated queue API, and run/signal APIs.

`apps/worker` constrains direct execution requests to `DOWNSTREAMCI_WORKSPACE_ROOT`. Its coordinator mode checks out the upstream on the trusted host, then delegates downstream setup/build/tests to the Docker sandbox.

The generic test container receives only explicitly configured environment values. It receives no GitHub credential, SSH key, production secret, or host Docker socket.

A host-side `DOWNSTREAMCI_GITHUB_READ_TOKEN` may be used for private Git clones; it is written only to a temporary Git home and is not forwarded through `runInDocker`.

## Sandbox and services

The runner uses a read-only root filesystem, `--cap-drop=ALL`, `no-new-privileges`, PID/CPU/memory/time limits, bounded output, tmpfs scratch space, and network `none` by default.

Optional service containers use a dedicated Docker network, no host port mappings, dropped capabilities, no-new-privileges, memory/PID bounds, read-only root by default, optional tmpfs, and optional Docker health checks. Without explicit `network: bridge`, the service network is `--internal` and cannot reach external networks.

## Persistence

- **SQLite** is the default local run-history store.
- **PostgreSQL** is available through `PostgresRunStore` when `DOWNSTREAMCI_DATABASE_URL` or `DATABASE_URL` is configured by the GitHub service.
- **Coordinator jobs** are stored durably in SQLite with leases so crashed workers can be recovered after lease expiry.
- **Artifacts** are local sanitized/checksummed files under `.downstreamci/artifacts/<run-id>/` in local CLI mode.

Object storage is intentionally an extension point: the comparison contract stores artifact references rather than requiring a proprietary storage service.

## Scaling

The deterministic comparison contract is independent of scheduling. A single machine can run the CLI directly. A self-hosted GitHub deployment can run one coordinator plus multiple polling workers. Additional worker transports/object stores can be added without changing baseline/candidate semantics or ecosystem adapters.
