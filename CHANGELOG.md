# Changelog

## Unreleased

### Added
- Vesting contract (`contracts/vesting`): `create`, `createBatch`, `claim`,
  `cancel`, owner endpoints (key collections, key display, fee, pause, fees),
  bounce recovery (`recoverBouncedKeys`, `recoverSurplus`), views and events.
- Schedules: cliff with an optional amount, then linear, stepped or explicit
  tranches.
- Tests: unit and property tests of the vesting maths against a reference
  model; blackbox tests of every endpoint and rule.
- Repository guards: `.gitignore` for keys, a pre-commit hook that refuses
  staged secrets, gitleaks in CI.
