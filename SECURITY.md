# Security Policy

DownstreamCI executes third-party downstream repositories and should be treated as security-sensitive CI infrastructure.

## Reporting a vulnerability

Do not publish exploit details, credentials, sandbox escapes, token leaks, webhook bypasses, or worker/coordinator authentication weaknesses in a public issue.

If GitHub private vulnerability reporting is enabled, use **Security → Report a vulnerability**. Otherwise, open a minimal non-sensitive issue requesting a private reporting channel.

Include the affected commit/version, deployment mode, operating system/container runtime, minimal reproduction, impact, and whether the issue can access host data, GitHub credentials, worker secrets, other jobs, or the Docker socket.

## Security boundaries

- Downstream repositories are untrusted input and run in disposable containers.
- Containers should not receive GitHub write credentials, SSH keys, host cloud credentials, or the Docker socket.
- Network access is disabled by default and should be enabled only by reviewed policy.
- Resource limits and timeouts must remain enforced even when callers bypass YAML parsing.
- `pull_request_target` is not a safe substitute for trusted-base policy and is intentionally refused by the bundled Action.
- Agent analysis is advisory and cannot alter deterministic baseline/candidate verdicts.
- Coordinator/worker APIs must fail closed when required authentication is absent.

Security changes should include regression tests and, where relevant, updates to `docs/security.md` or the self-hosting documentation.