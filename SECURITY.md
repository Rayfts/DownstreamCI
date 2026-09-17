# Security Policy

DownstreamCI executes third-party source code and must be treated as a high-risk build system.

## Reporting vulnerabilities

Do not publish exploitable sandbox escapes, credential leaks, token exposure, or command-injection details in a public issue. Use GitHub's private vulnerability reporting for this repository when available.

## Security invariants

- Downstream code is untrusted.
- Test containers never receive the host Docker socket.
- GitHub write credentials, SSH keys, cloud credentials, and production secrets are absent by default.
- Secret/environment injection must be explicit and scoped.
- Host-side clone credentials must remain outside the test-container environment.
- Worker filesystems/checkouts are disposable.
- CPU, memory, PID, and wall-clock limits have mandatory defaults.
- Network access defaults to disabled.
- Candidate source is mounted read-only.
- Candidate and baseline run under equivalent security policy.
- Distributed PR policy is loaded from the trusted base SHA, not the unreviewed head.
- Logs are bounded and sanitized before publication.
- Internal coordinator endpoints require a high-entropy bearer token.
- Direct worker execution requires a separate bearer token and fails closed when it is not configured.
- Service containers have no host port mappings and are capability-dropped/resource-bounded by default.

## Deployment guidance

Treat Docker daemon access on coordinator/worker hosts as privileged infrastructure. Do not expose the daemon socket to downstream containers. Restrict coordinator `/internal/*` to trusted workers/operators and rotate `DOWNSTREAMCI_INTERNAL_TOKEN` if it is exposed. Keep direct worker execution private and protect it with a distinct `DOWNSTREAMCI_WORKER_TOKEN`.

For private repositories, use a separate least-privilege read credential for host-side Git checkout. Do not reuse the GitHub App private key or a write-capable installation token inside workers or downstreams.
