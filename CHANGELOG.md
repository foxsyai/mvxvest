# Changelog

## Unreleased

### Changed (after the review of 2026-10-12)
- `create(beneficiary, total, schedule, cancelable, label)`: the total is
  explicit, so a fee change in flight fails instead of changing the vesting.
- The creator can only recover a claim key that never reached a holder.
- `recoverBouncedKeys` returns what the caller may take; `keyRecovered`
  replaces `keysRecovered` and names the key.
- `getNextRelease` is exact for linear curves and empty only when nothing more
  will vest.
- Stepped schedules need `end > start`.
- The code metadata is checked at call time (not in `init`/`upgrade`, which
  cannot see it on the real chain): while payable, `create` is refused and the
  creator cannot recover claim keys.
- `vestingClaimed` is emitted for every key sent to `claim`; `getVesting`
  shows `claim_key_used`.
- Go VM scenarios (deploy, payable contract, full lifecycle) run in the tests
  and in CI.
- The collection views return empty until the collections are issued.

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
