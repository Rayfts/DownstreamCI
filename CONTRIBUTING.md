# Contributing

Thank you for improving DownstreamCI.

## Development

Use Node 22+ and pnpm via Corepack.

```bash
corepack enable
pnpm install
pnpm check
pnpm build
```

Keep deterministic CI facts separate from coding-agent analysis. A harness adapter must cite a stable, public upstream mechanism in `docs/harness-adapters.md`; do not guess CLI flags.

When adding an ecosystem adapter, add a fixture where baseline passes and the candidate breaks, plus a fixture or test showing a pre-existing baseline failure is not reported as a regression.

Security changes should preserve the rule that untrusted downstream code receives no GitHub write token, SSH key, host Docker socket, or production credential by default.
