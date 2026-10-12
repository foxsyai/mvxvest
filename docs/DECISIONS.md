# Decisions

Agreed with Sebastian on 2026-10-12 (brief section 10), plus design choices
made while building milestone 1.

## Agreed

| # | Topic | Decision |
|---|---|---|
| 1 | Licence | Written from scratch; Pulsar studied for ideas only. GPL-3.0-only for the repo: the MultiversX framework (`multiversx-sc`) is GPL-3.0-only and is compiled into the contract anyway. |
| 2 | Fee | Flat EGLD fee per vesting, paid by the creator on top of the deposit, never by beneficiaries. Capped at 1 EGLD in code; 0 on devnet and during the private beta. Collected by the owner multisig with `claimFees`. A creation must pay exactly the current fee. |
| 3 | Upgrades | Upgradeable by the mvxsafe multisig, also on mainnet, so a serious bug can be fixed. The site says so and names the signers and quorum; each version's code hash comes from the reproducible build. Freezing can be revisited once the contract has run cleanly for a while. |
| 4 | NFTs | `MvxVestClaimKey` / `VESTKEY` and `MvxVestCancelKey` / `VESTCANCEL`. Placeholder SVG images on devnet; final art before mainnet, pinned on IPFS. |
| 5 | Splitting | Later (a v2 feature). |
| 6 | Hosting | Static build on the mvxsafe droplet behind nginx, Let's Encrypt. Domain `mvxvest.io` (bought by Sebastian); `devnet.mvxvest.io` for the devnet build. |
| 7 | Audit | Ask Arda and Runtime Verification for quotes once the contract is feature-frozen. |
| 8 | GitHub | `foxsyai/mvxvest`, private until audited. |

## Design choices (milestone 1)

- **State in storage, stable nonces.** Unlike Pulsar, which re-mints the
  payment token on every claim, each key keeps its nonce for life; mutable
  state (`claimed`, `cancelledAt`) is in storage keyed by vesting id. The
  contract never reads NFT attributes, so they are plain display data.
- **One formula for every schedule** (spec section 1): a cliff with an optional
  amount, then linear, stepped or explicit tranches. Covers startup-style
  catch-up cliffs, "X% at TGE then linear", time locks and calendar schedules.
- **Stepped rounding** is `floor(rest * k / n)`: steps differ by at most one
  unit and the total is exact at the end, with no "divisible by 1000" rule.
- **Claim and cancel accept several keys** in one transaction ("Claim all");
  payouts are merged per token.
- **Indexes for the dApp without an indexer:** vestings by creator and by
  token (paged), totals per token, nonce to vesting.
- **The vesting records its original beneficiary** for display; only the
  current holder of the claim key can claim.
- **Bounce recovery.** A transfer to a smart contract that cannot receive
  tokens bounces back. `recoverBouncedKeys` (creator or owner, narrowly
  scoped) and `recoverSurplus` (owner, only above what is owed) make sure no
  bounce locks anything forever. With an upgradeable contract the multisig is
  trusted anyway, so these add no new trust.
- **Limits:** 120 tranches, 100 vestings per batch (gas sets the practical
  limit; see MEASUREMENTS.md), 64-byte labels, 30-year horizon, pages of 100.
- **Payments:** EGLD is accepted both as plain value and as `EGLD-000000`
  inside a multi-transfer.
