# Changelog

## Version 3 (not deployed yet; audited 21 Oct 2026)

Reproducible build `multiversx/sdk-rust-contract-builder:v12.0.0`, code hash
`65c689b9d0cefdc5e39e2d1f4e7110e0c3da787a8a56dbf163a3d59ce6e6101d`, 29,327 bytes.

### Added
- A claim key shows what has been claimed: each claim that pays and returns
  the key rewrites its name (`, 25% claimed`) and attributes
  (`;claimed:<units>`) with `ESDTMetaDataUpdate`, keeping its URIs and the
  metadata it was minted with (fourth audit, SCK-1).
- A cancelable vesting's claim key says so in its name from the mint
  (`Vesting #N claim key, cancelable`; SCK-2).
- `setKeyStamping(on)`, `isKeyStamping` and the event `keyStampingSet`: the
  owner can turn the stamp off and on; it changes only what a key shows.
- `getClaimKeyStatus(nonce)` (a claim key's vesting in one call) and
  `getDeficit(token)` (SCM-1).

## Version 2 (mainnet since 14 Oct 2026, audited twice)

Reproducible build `multiversx/sdk-rust-contract-builder:v12.0.0`, code hash
`a7acbf22b8fdd8f1e624dfd1354aacae4ccb20c0ef5974e1946704359bab718a`, 27,332 bytes.

### Added
- `setTokenFee(bps)`, `getTokenFee`, `getMaxTokenFee`, events `tokenFeeSet`
  and `tokenFeePaid`: a share of each vesting's total in its own token, at
  most 2%, paid by the creator on top of the total and sent to the owner in
  the same transaction. 0 until set.
- `recoverSurplus(token, to, [amount])`: a surplus can be returned in parts
  (first audit, C1).
- New keys carry `cancelable:0` or `cancelable:1` in their attributes (first
  audit, RT3).

### Changed
- Batches hold at most 49 vestings, 32 when cancelable (the token fee's
  transfer is one more built-in call).

## Version 1 (mainnet since 12 Oct 2026, code hash `fd32f4e1…`)

### Changed (after the reviews of 2026-10-12)
- `create(beneficiary, total, schedule, cancelable, label)`: the total is
  explicit, so a fee change in flight fails instead of changing the vesting.
- Bounce recovery is owner only and one key per call:
  `recoverBouncedKey(id, kind, to)` replaces `recoverBouncedKeys`, with one
  `keyRecovered` event naming the key. The creator can no longer recover keys.
- `getNextRelease` is exact for linear curves and empty only when nothing more
  will vest.
- Stepped schedules need `end > start`.
- Batches hold at most 50 vestings, 33 when cancelable: the network allows
  about 100 built-in calls per transaction (measured on devnet). The cancel
  keys of a batch are collected without a quadratic search.
- `disableKeyBurnByHolders(kind)`: removes the default `ESDTRoleBurnForAll`
  from a key collection, so holders cannot burn keys.
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
