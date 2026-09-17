# Sandbox and threat model

A downstream repository can execute arbitrary code. Treat it as hostile.

## Default controls

The Docker runner uses:

- disposable baseline and candidate workspaces
- a read-only container root filesystem
- writable workspace plus isolated `/tmp` tmpfs
- `--cap-drop=ALL`
- `no-new-privileges`
- PID, CPU, memory, and wall-clock limits
- network `none` by default
- explicit environment-variable injection only
- environment values omitted from command evidence
- bounded stdout/stderr capture
- no host Docker socket mount
- candidate source mounted read-only at `/candidate`

The source workspace is writable because build systems require it. The worker host must therefore treat the workspace as disposable and keep credentials outside it.

## Host-side Git

Downstream checkout disables system/global Git configuration and terminal credential prompts by using an isolated HOME and `GIT_CONFIG_NOSYSTEM=1`. This reduces exposure to host-configured filters/helpers while fetching public OSS revisions.

## Network

Dependency installation and tests often need different policies. The current config exposes `none` and Docker `bridge`. Keep `none` unless an approved downstream requires package/network access. A production worker can replace bridge egress with an allow-listed proxy without changing the comparison contract.

## Secrets

Do not put GitHub App private keys, GitHub write tokens, SSH agents, package-publish tokens, cloud credentials, or production secrets into generic downstream environments. Check output applies best-effort redaction for common token forms, but redaction is defense in depth—not permission to inject secrets.

## Docker-in-Docker

Do not mount `/var/run/docker.sock` into untrusted test containers. If a downstream requires containers, place the worker inside a stronger isolation boundary such as a dedicated VM/microVM or reviewed rootless nested engine.
