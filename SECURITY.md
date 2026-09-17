# Security Policy

DownstreamCI executes third-party source code and must be treated as a high-risk build system.

## Reporting vulnerabilities

Do not publish exploitable sandbox escapes, credential leaks, token exposure, or command-injection details in a public issue. Use GitHub's private vulnerability reporting for this repository when available.

## Security invariants

- Downstream code is untrusted.
- A test container must not receive the host Docker socket.
- GitHub write credentials, SSH keys, cloud credentials, and production secrets are absent by default.
- Secret injection must be explicit and scoped.
- Worker filesystems are disposable.
- CPU, memory, PID, and wall-clock limits are mandatory defaults.
- Network access defaults to disabled.
- Logs must be sanitized before publication.
- Candidate and baseline must run with equivalent security policy.
