# Brief: a public token-vesting dApp on MultiversX

You are starting a new project for Sebastian Marian (FOXSY). This folder,
`~/FOXSY/mvxvest`, is the project's root; this README is the brief until the
project has its own (then move it to `docs/BRIEF.md`). Read this whole
brief before writing code, then confirm the open decisions (section 10) with
him. The working name is **mvxvest** (domain still to be bought, see
section 11). Start in a **private** GitHub repository; it becomes public when
it is finished and audited.

## 1. What to build

A dApp that lets any project on MultiversX lock tokens in a vesting smart
contract for its team, investors or community, and lets each beneficiary
claim what has vested by connecting their wallet.

- **Creators** (a project, a DAO, a team lead) deposit an ESDT token or EGLD
  and define one or many vestings: beneficiary, amount, schedule (cliff,
  then linear or stepped releases), and whether it can be cancelled.
- **Each beneficiary receives an NFT** that is the key to the vesting. Whoever
  holds the NFT can claim, so it can be moved to another wallet (a new wallet,
  a sale of the position, a multisig). The original address has no special
  right once the NFT has left it.
- **Cancelable vestings** give the creator a second NFT, the cancel key.
  Sending it to the contract stops that vesting at that moment: what has
  vested stays claimable by the holder of the claim NFT, the unvested rest
  returns to whoever cancelled. A non-cancelable vesting has no cancel key
  and can never be stopped.
- **Beneficiaries see, read-only, without signing anything:** their schedule,
  what they claimed, what they can claim now, the next tranches and their
  dates. With a connected wallet they press Claim.
- **Creators see** their vestings, every beneficiary's progress, and Cancel
  where allowed.
- **Anyone can look up** a token, a vesting or an address, read-only, so a
  community can verify a team's vesting (transparency is the selling point).

Sebastian already runs a private, server-side vesting for FOXSY (a Python
service in `~/FOXSY/foxsy-ops`, `foxsy_vesting.py`) that pays tranches from a
hot wallet. This new product is different: trustless, on-chain, claimable,
public. Do not touch foxsy-ops. Its vesting model (cadences daily, weekly,
biweekly, monthly, quarterly, semiannual, annual; optional cliff; last
tranche absorbs rounding; catch-up of past tranches) is a useful reference
for what real teams ask for.

## 2. Prior art: Pulsar Money (study it, do not copy it blindly)

Pulsar Money ran "Smart Transfers" on MultiversX (vaults, payments,
vesting). As of 2026-10-12 `docs.pulsar.money` no longer resolves and
`beta.pulsar.money` answers HTTP 500: it appears to be gone. Its contract is
open source: **github.com/javi4554/pulsar-contract**, licence **GPL-3.0**,
Rust (`multiversx-sc`), with scenario tests. How it works:

- `create(payment_type, name, cancelable, receivers, releases...)` payable
  with the token (amount plus a fee of up to 10% that goes to the contract
  owner). A release is `{start_date, end_date, interval_seconds, amount}`;
  start dates must be in the future; the amount per interval must divide by
  1,000.
- Per receiver it mints a **payment token** (an SFT with 1,000 units whose
  attributes hold the whole schedule) and sends it to the receiver. The 1,000
  units let a holder split the claim right by sending part of it.
- `claim`: the holder sends the token in; the contract pays what vested,
  burns the token and mints a **new** one (new nonce) with the remaining
  releases.
- If cancelable, the creator gets a **cancellation token** per receiver.
  `cancel`: the token is sent in, the cancel time is stored, the unvested
  amount is paid back to the caller, vested tranches stay claimable.

Keep the good ideas (NFT as the transferable claim right, a separate
transferable cancel right, one contract for many vestings, splitting). Fix
these on purpose:

1. **Re-minting on every claim** gives the position a new nonce each time.
   Wallets, explorers and the UI lose track of "the same" vesting. Keep one
   NFT per vesting with a stable nonce, and keep the mutable state (claimed
   amount, cancel time) in contract storage keyed by vesting id. The NFT's
   attributes hold only what never changes (vesting id, token, display
   metadata).
2. **The "divisible by 1,000" rule** and **future-only starts** are hostile to
   real schedules. Use exact integer arithmetic with the remainder in the last
   tranche, and allow a start in the past (its vested part is claimable at
   once): projects migrate existing vestings.
3. **Stepped releases only.** Offer: cliff, then either linear per second or
   stepped by an interval, or an explicit list of tranches (date, amount) up
   to a bound, for schedules like "monthly, first of the month".
4. **Fees out of the deposit, up to 10%, owner-set.** If there is a fee,
   make it small, capped in the contract, shown before signing, and never
   taken from beneficiaries.
5. **Licence.** Reusing Pulsar's code makes your contract GPL-3.0 (and,
   arguably, everything that includes it). Either write the contract from
   scratch (recommended, it is small) or confirm with Sebastian that the
   project will be GPL-3.0. Do not paste their code before that decision.

## 3. Scope

**Version 1 (private beta on devnet, then mainnet):**
- the vesting contract (section 4) with full tests;
- the dApp (section 5): create (single and CSV batch), my vestings as a
  beneficiary, my vestings as a creator, claim, cancel, public lookup;
- deployment scripts for devnet, testnet and mainnet;
- documentation: README, contract API, a short user guide.

**Not in v1:** an indexer or database (read the chain through views and the
public API), governance, multiple chains, a token launchpad, staking of
vested tokens, a mobile app.

**Later:** splitting a position (SFT units or a split endpoint),
"streams" (salaries paid per second), notifications, a subgraph-like
indexer, partner integrations.

## 4. The smart contract

Rust with the current `multiversx-sc` framework and `sc-meta`. One contract,
many vestings.

**Storage, per vesting id (u64, increasing):**
`creator`, `token` (EGLD or ESDT identifier and nonce 0), `total`,
`schedule` (cliff time and amount, start, end, kind: linear | stepped with
interval | explicit tranches), `claimed`, `cancelable`, `cancelled_at`
(0 if not), `claim_nonce` (of the claim NFT), `cancel_nonce` (0 if not
cancelable), `created_at`, a short `label`.

**Tokens the contract issues once (owner, at setup):** a claim NFT
collection and a cancel NFT collection, with the contract holding the
create and burn roles. Name and ticker to agree with Sebastian (for example
`VESTKEY` and `VESTCANCEL`).

**Endpoints:**
- `create(beneficiary, schedule, cancelable, label)` payable with exactly the
  vested total (plus the fee, if any): mints the claim NFT to the
  beneficiary and, if cancelable, the cancel NFT to the caller. Returns the
  id.
- `createBatch(list of (beneficiary, amount, schedule), cancelable, label)`
  payable with the sum: the same for many, bounded by gas (measure it; at
  most about 50 per transaction; the UI splits a CSV into several
  transactions and shows each one).
- `claim()` payable with the claim NFT: pays everything vested and not yet
  claimed, then sends the NFT back (same nonce), or burns it when the vesting
  is fully claimed or cancelled and settled.
- `cancel()` payable with the cancel NFT: refused if not cancelable or
  already cancelled; sets `cancelled_at = now`; pays the unvested remainder
  to the caller; burns the cancel NFT. The vested part stays claimable with
  the claim NFT.
- Owner only: set the fee (capped in code), pause and unpause **creation**
  (never claims or cancels), claim accumulated fees. The owner can never move
  locked funds.

**Views (the UI reads everything through them):** `getVesting(id)`,
`getClaimable(id)`, `getVestedAt(id, timestamp)`, `getNextRelease(id)`,
`getVestingsByCreator(address)` (bounded or paginated),
`getVestingByClaimNonce(nonce)`, fee and pause status.

**Events** for every create, claim and cancel (ids, amounts, addresses), so
a future indexer can rebuild history.

**Rules and edge cases to test:**
- vested(t) is monotonic, never exceeds the total, and reaches it exactly at
  the end (rounding remainder in the last tranche or at the end);
- claimed is never more than vested; claim twice in one block pays once;
- cancel at any moment (before the cliff, mid-way, after the end) splits
  vested and unvested exactly, summing to the total;
- the claim NFT moved to another wallet: the new holder claims, the old one
  cannot;
- EGLD and ESDT with 0, 6 and 18 decimals; very large and very small
  amounts; a start in the past; a cliff equal to the total; explicit
  tranches out of order (refused);
- a token with a transfer role or fee on transfer (refuse or document);
- reentrancy and async-call ordering (use synchronous transfers; state
  before transfers);
- nothing can lock funds forever (every path ends claimable or refunded).

Write scenario tests (Rust `ScenarioWorld` / blackbox tests) for every
endpoint and every rule above, plus property-style tests on the vesting
maths. Target full branch coverage of the vesting maths.

**Ownership and upgrades:** the contract owner must be a **multisig**.
Sebastian has his own MultiversX multisig interface, **mvxsafe**
(`mvxsafe.io`); use it. Decide with him whether the contract stays
upgradeable (by the multisig) or is frozen after the audit; say which on
the site either way.

**Audit:** before any mainnet use with third-party funds, an external audit
(for example Runtime Verification, Hacken, Arda) and an internal adversarial
review. Sebastian runs adversarial reviews with independent reviewers; expect
one on the contract and one on the dApp.

## 5. The dApp

**Stack:** TypeScript, React (Next.js or Vite), `@multiversx/sdk-dapp` for
wallets (xPortal, DeFi Wallet extension, Web Wallet, Ledger, WalletConnect),
`@multiversx/sdk-core` for transactions and ABI-typed contract calls, the
public MultiversX API and gateway for reads. No backend in v1; the site can
be static (host it on the same droplet behind nginx, or a static host).

**Pages:**
- **Home:** what it is, the two keys (claim and cancel), a lookup box
  (address, token, vesting id).
- **Create:** a step-by-step form. Token (from the connected wallet's
  balances), beneficiaries (one by one or a CSV with address and amount),
  schedule builder (cliff, start, end, linear or every N days/months, or
  explicit tranches) with a **chart and a table of every release before
  signing**, cancelable yes or no with a plain explanation, review (totals,
  fee, number of transactions), sign.
- **My vestings, as a beneficiary:** every claim NFT in the wallet, each with
  a progress bar, claimed, claimable now, next release and date, the full
  schedule, the history, and Claim (one or all).
- **My vestings, as a creator:** every vesting created, every beneficiary's
  progress, Cancel where the wallet holds the cancel key, export to CSV.
- **Public vesting page** (`/v/<id>`): read-only, shareable, no wallet needed.
- **Token page** (`/t/<token>`): every vesting of a token, total locked,
  vested and claimed, the unlock calendar. This is what communities look at.

**UX rules:** amounts with thousands separators and the token's decimals;
dates in the user's time zone with UTC shown on hover; every transaction
shows what it does before signing and its result after (explorer link);
light and dark mode; works on a phone. In user-facing text, no em-dashes and
no Oxford commas (Sebastian's style).

## 6. Repository and tooling

- New **private** repo under Sebastian's GitHub (ask which account or org;
  his other repos are under `foxsyai`).
- Layout: `contracts/vesting/` (the contract, its `meta`, scenarios),
  `dapp/` (the web app), `scripts/` (deploy and interaction scripts for
  devnet, testnet and mainnet), `docs/`.
- CI on every push: contract build (reproducible build in Docker for the
  final wasm), contract tests, dApp lint, type check and tests.
- Never commit keys, PEM files, mnemonics or `.env` files. Deployment keys
  live outside the repo; mainnet actions go through the multisig.

## 7. How Sebastian works (follow it)

- **Ambiguity means verify:** an uncertain money outcome is never retried
  blindly or reported as done; prove it on chain first.
- **Ask before anything irreversible or public:** deploying to mainnet,
  issuing the collections on mainnet, making the repo public, buying the
  domain.
- **Review your own fixes:** every finding that is fixed gets a test that
  fails on the old code, and fixes get a second review.
- Never print or log secrets; never put secrets in the repo.
- Keep a README that a newcomer can follow, and a CHANGELOG.

## 8. Milestones and what "done" means

1. **Contract on devnet:** all endpoints, views and events; scenario tests
   for every rule in section 4 pass; deployed on devnet with test
   collections; a script creates, claims, transfers the NFT and claims
   again, and cancels.
2. **dApp on devnet:** every page in section 5 works against the devnet
   contract with xPortal and the DeFi Wallet extension; a CSV of 120
   beneficiaries creates correctly in several transactions.
3. **Review and audit:** internal adversarial review fixed; external audit
   report with every finding addressed.
4. **Mainnet beta (private):** owned by the mvxsafe multisig; Sebastian
   vests a test amount of FOXSY to himself and a colleague and runs a claim,
   a transfer of the claim NFT and a cancel.
5. **Public launch:** domain live, repo public, docs and terms published.

## 9. Things to measure and report early

Gas per create, per batch size, per claim and per cancel on devnet; the
maximum batch size; the storage cost per vesting; whether wallets display
the NFTs well (name, image, attributes); the explorer's view of the
collections.

## 10. Decisions to confirm with Sebastian before coding

1. Licence: clean-room implementation (recommended) or GPL-3.0 because of
   reuse of Pulsar's code.
2. Fee: none, a small percentage capped in the contract, or a flat EGLD fee
   per vesting; who receives it.
3. Upgradeable by the multisig, or frozen after the audit.
4. The NFT collections' names, tickers and the NFT image.
5. Splitting a position in v1 or later.
6. Hosting of the dApp, and the domain (section 11).
7. Audit firm and budget.

## 11. Name and domain

Names starting with `mvx` and ending in `.io`, checked with the .io
registry on 2026-10-12 (not registered at that moment; registration can
change any time):

- **mvxvest.io**: short, says what it does, matches his `mvxsafe.io` (the
  first choice);
- mvxvesting.io: explicit, longer;
- mvxunlock.io: what holders care about (unlocks);
- mvxvault.io: the locked funds;
- mvxclaim.io: what the beneficiary does;
- mvxtranche.io: precise, less known word;
- mvxstream.io: fits if salary streams come later;
- mvxlocker.io, mvxdrip.io, mvxcliff.io, mvxflow.io, mvxrelease.io: other
  free options.

`mvxsafe.io` (multisig) plus `mvxvest.io` (vesting) reads as one family of
MultiversX tools.
