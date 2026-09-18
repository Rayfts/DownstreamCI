## Summary

Describe the change and the compatibility/maintainer problem it solves.

## Deterministic impact

Does this affect baseline/candidate execution, classifications, flake detection, ecosystem injection, sandboxing, or agent-analysis boundaries? Explain or write `None`.

## Validation

List tests, fixture matrices, Docker runs, or commands used to validate the change.

## Checklist

- [ ] Baseline/candidate verdicts remain deterministic.
- [ ] Pre-existing failures cannot become `newly-broken` through this change.
- [ ] Untrusted downstream code does not receive new host privileges or credentials.
- [ ] I added or updated tests/fixtures for behavior changes.
- [ ] I did not invent undocumented harness behavior.
- [ ] I updated relevant docs or changelog entries.