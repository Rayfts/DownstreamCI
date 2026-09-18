# Support

DownstreamCI is a pre-1.0 open-source project. Community support is best-effort; there is no guaranteed response time or commercial SLA.

## Before opening an issue

Check the README and documents under `docs/`, then run:

```bash
downstreamci doctor
downstreamci harnesses
```

For execution problems, include the selected runner image, ecosystem/package manager, downstream configuration, and sanitized baseline/candidate logs.

## Bugs

Use the bug-report form. Include the DownstreamCI commit/version, Node/pnpm versions, Docker version, operating system, relevant `.downstreamci.yml` excerpt, and a minimal upstream/downstream reproduction when practical.

## Feature requests

Use the feature-request form. Describe the compatibility problem first, then the desired behavior. For a new ecosystem, include the package manager's official candidate-replacement mechanism and an example downstream project.

## Security

Do not report vulnerabilities through a normal issue. Follow `SECURITY.md`.

## Questions

Focused usage and self-hosting questions are welcome as GitHub issues when the documentation does not already answer them. Keep one problem per issue so answers remain searchable.