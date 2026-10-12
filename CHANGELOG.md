# Changelog

## Unreleased

### Changed (after the reviews of 2026-10-12)
- `create(beneficiary, total, schedule, cancelable, label)`: the total is
  explicit, so a fee change in flight fails instead of changing the vesting.
- Bounce recovery is owner only and one key per call:
  `recoverBouncedKey(id, kind, to)` replaces `recoverBouncedKeys`, with one
  `keyRecovered` event naming the key. The creator can no longer recover keys.
- `getNextRelease` is exact for linear curves and empty only when nothing more
  will vest.
- Stepped schedules need `end > start`.
- `MAX_BATCH` is 75 (a cancelable batch of 100 does not fit in 600M gas); the
  cancel keys of a batch are collected without a quadratic search.
- The collection views return empty until the collections are issued.

### Added
- Go VM scenarios (deploy, full lifecycle, every payment and payout shape,
  bounce recovery, the largest batch) run in the tests and in CI.
- Vesting contract (`contracts/vesting`): `create`, `createBatch`, `claim`,
  `cancel`, owner endpoints (key collections, key display, fee, pause, fees),
  bounce recovery (`recoverBouncedKey`, `recoverSurplus`), views and events.
- Schedules: cliff with an optional amount, then linear, stepped or explicit
  tranches.
- Tests: unit and property tests of the vesting maths against a reference
  model; blackbox tests of every endpoint and rule.
- Repository guards: `.gitignore` for keys, a pre-commit hook that refuses
  staged secrets, gitleaks in CI.
