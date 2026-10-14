# Decisions

Agreed with Sebastian on 2026-10-12 (brief section 10), plus design choices
made while building milestone 1.

## Agreed

| # | Topic | Decision |
|---|---|---|
| 1 | Licence | Written from scratch; Pulsar studied for ideas only. GPL-3.0-only for the repo: the MultiversX framework (`multiversx-sc`) is GPL-3.0-only and is compiled into the contract anyway. |
| 2 | Fee | Flat EGLD fee per vesting, paid by the creator on top of the deposit, never by beneficiaries. Capped at 1 EGLD in code; 0 on devnet and during the private beta. Collected by the owner multisig with `claimFees`. A creation must pay exactly the current fee. |
| 3 | Upgrades | Upgradeable by the mvxsafe multisig, also on mainnet, so a serious bug can be fixed. The site says so and names the signers and quorum; each version's code hash comes from the reproducible build. Freezing can be revisited once the contract has run cleanly for a while. |
| 4 | NFTs | `MvxVestClaimKey` / `VESTKEY` and `MvxVestCancelKey` / `VESTCANCEL`. Art: the fox head with the key on a dark card. The claim key is **green** and the cancel key **red**, so the two are told apart at a glance (decided on 12 Oct 2026). Images are served from mvxvest.io/nft/ (`claim-key-2.*`, `cancel-key.*`). |
| 5 | Splitting | Later (a v2 feature). |
| 6 | Hosting | Static build on the mvxsafe droplet behind nginx, Let's Encrypt. Domain `mvxvest.io` (bought by Sebastian); `devnet.mvxvest.io` for the devnet build. |
| 7 | Audit | No external audit firm for now (Sebastian, 12 Oct 2026). Order: mainnet first, for in-house use; then one or more large adversarial audits by Claude Fable 5.1 at max effort, covering contract, dApp, deployment and funds, and trying every malicious action. The repo goes public only after two or three clean rounds. |
| 8 | GitHub | `foxsyai/mvxvest`, private until those audit rounds pass. |
| 9 | Mainnet owner | The mvxsafe multisig, contract upgradeable. A single-purpose deployer wallet deploys and sets up the contract, then hands ownership to the multisig with `ChangeOwnerAddress` and sends its leftover EGLD there. The multisig was chosen over self-ownership, which would freeze the contract: no bug fix, no pause, no return of bounced keys. Sebastian chose this on 12 Oct 2026. |
| 10 | Platform fee (13 Oct 2026; rate set to 0.1% on 14 Oct) | **0.1% of each vesting's amount, in its own token, paid by the creator on top of the deposit**: a 1,000 FOXSY vesting costs 1,001 FOXSY and the beneficiary receives exactly 1,000. The fee goes straight to the owner multisig in the same transaction. **Plus 0.1 EGLD per vesting** (#2's flat fee), against spam: the share of a dust vesting rounds to nothing. 0.1% is what UNCX charges, the one major vesting platform that takes a share of the tokens; Team Finance, Streamflow, Sablier and Hedgey take none. 1% was first agreed, then lowered to match the market. The multisig can change both by vote, with the rate capped in code (2%) as the EGLD fee is (1 EGLD). Needs a contract upgrade, which ships with the next audit rounds; until then creating is free. |

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
- **Bounce recovery, owner only.** A transfer to a smart contract that cannot
  receive tokens bounces back. `recoverBouncedKey` (one key per call) and
  `recoverSurplus` (only what exceeds what is owed) let the owner multisig
  return it, so no bounce locks anything forever. Only the owner: letting the
  creator recover keys was the source of a finding in every review. With an
  upgradeable contract the multisig is trusted anyway, so this adds no new
  trust.
- **Limits:** 120 tranches, 50 vestings per batch or 33 cancelable ones (the
  network's limit of about 100 built-in calls per transaction, measured on
  devnet; see MEASUREMENTS.md), 64-byte labels, 30-year horizon, pages of 100.
- **Keys cannot be burned by holders:** new collections get the protocol's
  `ESDTRoleBurnForAll`; `disableKeyBurnByHolders` removes it, so nobody can
  destroy a claim key and lock a vesting forever by accident.
- **Payments:** EGLD is accepted both as plain value and as `EGLD-000000`
  inside a multi-transfer. `create` takes the total as an argument (like
  `createBatch`), so the payment must be exactly the total plus the fee.
- **Deployed non-payable** (and not payable by smart contracts), so stray
  transfers bounce. Nothing depends on it for safety.
- **Two VMs in the tests:** the Rust test VM for the full suite, and the Go VM
  (the one validators run) for deploy, the full lifecycle, every payment and
  payout shape, recovery and the largest batch, because the two VMs differ
  (second review).

## Reviews

- 2026-10-12, internal adversarial review of the contract, then a second and
  a third review of the fixes: [reviews/2026-10-12-contract.md](reviews/2026-10-12-contract.md).
