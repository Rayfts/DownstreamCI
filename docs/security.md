# Sandbox and threat model

A downstream repository can execute arbitrary code. Treat it as hostile.

## Trusted policy for pull requests

Both supported GitHub PR integrations separate candidate source from execution policy:

- the GitHub App worker checks out candidate code from the PR head repository/SHA and loads `.downstreamci.yml` from the signed webhook's base SHA;
- the composite GitHub Action automatically reads the config from `github.event.pull_request.base.sha` and refuses `pull_request_target`.

This prevents an unreviewed PR from granting itself network access, replacing the approved downstream set, raising resource limits, or changing execution commands. A first-time policy must be reviewed/merged before it governs automated PR testing.

## Default controls

The Docker runner uses disposable baseline/candidate workspaces, a read-only root filesystem, writable workspace plus isolated `/tmp`, `--cap-drop=ALL`, `no-new-privileges`, bounded PID/CPU/memory/time, network `none` by default, explicit environment injection, bounded logs, no host Docker socket, and a read-only `/candidate` mount.

Candidate input is first copied into a temporary **tracked-only Git snapshot**. Downstream containers never receive the upstream repository's `.git` directory, ignored files, or untracked host files such as local `.env` files and editor/build artifacts. The snapshot reflects current tracked working-tree content, is mounted read-only, and skips gitlink/submodule working trees rather than recursively exposing their untracked contents. Non-Git candidate paths fail as setup errors instead of being mounted wholesale.

Worker-side defense in depth clamps programmatic execution requests to at most 16 CPUs, 32 GiB RAM, 4,096 PIDs, and two hours per command. Configuration validation applies the same ceilings. Service sidecars are limited to eight per downstream, 8 GiB RAM and 1,024 PIDs each, with health waits capped at five minutes.

## Worker API

The direct worker execution endpoint `POST /v1/execute` is disabled unless `DOWNSTREAMCI_WORKER_TOKEN` is configured and requires `Authorization: Bearer <token>` on every request. Token comparison is constant-time. The direct API accepts only Docker network modes `none` and `bridge`; arbitrary existing Docker network names are rejected. `/healthz` remains unauthenticated for orchestration probes.

Keep the worker service on a private network/firewall segment even when bearer authentication is enabled. `DOWNSTREAMCI_INTERNAL_TOKEN` is separately used for worker-to-coordinator queue traffic and should not be reused as the direct execution token.

## Host-side Git and secrets

Git checkout uses an isolated HOME, disables system Git configuration and terminal credential prompts, and keeps optional read credentials in a temporary `.netrc`. Do not put GitHub App private keys, GitHub write tokens, SSH agents, package-publish tokens, cloud credentials, or production secrets into generic downstream environments. Check-output redaction is defense in depth, not permission to inject secrets.

Optional coding-agent subprocesses also run with an isolated HOME/USERPROFILE/XDG config/cache/temp environment rather than inheriting the worker's full `process.env`. Only a small platform environment plus explicitly supported model-provider variables is forwarded. `GITHUB_*`, `GH_TOKEN`, `DOWNSTREAMCI_*`, `AWS_*`, and secret/password/private-key-shaped allowlist entries are excluded even when an operator adds them to `DOWNSTREAMCI_AGENT_ENV_ALLOWLIST`.

## Network

Dependency installation and tests often need different policies. Keep `network: none` unless an approved downstream needs package/network access. `bridge` egress is explicit and comes from trusted policy. A production worker can replace bridge egress with an allow-listed proxy without changing the comparison contract.

## Docker-in-Docker

Do not mount `/var/run/docker.sock` into untrusted test containers. If a downstream requires containers, place the worker inside a stronger isolation boundary such as a dedicated VM/microVM or reviewed rootless nested engine.
