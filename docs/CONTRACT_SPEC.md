# Contract specification

The rules the vesting contract implements. This is **version 3**, not deployed
yet: mainnet runs version 2 since 14 October 2026 (code hash a7acbf22…,
[MAINNET.md](MAINNET.md)). Version 3 differs from version 2 in what a claim key
shows: a cancelable vesting's claim key says so in its name; each claim that
pays rewrites the returned key's name and attributes with what has been
claimed (the fourth audit's SCK-1 and SCK-2). It adds the owner's switch for
that (`setKeyStamping`) and three views (`getClaimKeyStatus`, `getDeficit`,
`isKeyStamping`). Version 2 differed from version 1, which ran from 12 to 14
October, in four places: the token fee, the batch limits (49 and 32 instead of
50 and 33), `recoverSurplus`'s amount and the `cancelable` marker in the key
attributes.

The code is in
[contracts/vesting/src](../contracts/vesting/src); each rule is checked by the
tests listed in [TESTS.md](TESTS.md). Timestamps are block timestamps in
seconds. Amounts are integers in the token's smallest unit.

## 1. Vesting maths

A schedule has `start`, `cliff`, `cliff_amount`, `end` and a curve. It must
satisfy `start <= cliff <= end` and `cliff_amount <= total`. Let
`rest = total - cliff_amount`.

```
vested(t) = 0                                   if t < cliff
          = total                               if t >= end
          = cliff_amount + released(t)          otherwise
```

`released(t)`, for `cliff <= t < end` (so `end > start`):

| Curve | `released(t)` | Extra rules |
|---|---|---|
| Linear | `floor(rest * (t - start) / (end - start))` | none |
| Stepped `{ interval }` | `floor(rest * k / n)` with `n = ceil((end - start) / interval)` and `k = floor((t - start) / interval)` | `0 < interval <= end - start` (so `end > start`) |
| Tranches `[(time, amount)]` | sum of `amount` over tranches with `time <= t` | 1 to 120 tranches; every amount > 0; times strictly increasing, the first `>= start`, the last `== end`; amounts sum to `rest` |

Consequences, all tested:

- vested(t) never decreases, never exceeds the total and equals the total
  exactly from `end` on (rounding remainders land at the end or are spread by
  at most one unit per step);
- the cliff gates everything: what the curve released before it unlocks at
  once at the cliff (the "startup" style, with `cliff_amount = 0`);
- "X at the cliff, then the rest linearly until the end" is `start = cliff`
  with `cliff_amount = X`;
- `cliff_amount = total` releases everything at the cliff; `start = cliff =
  end` is a plain time lock;
- a schedule may start in the past: what has vested is claimable at once;
- calendar schedules ("the first of every month") use explicit tranches; the
  dApp computes the dates.

A schedule must end within 30 years of its creation (`MAX_HORIZON`), so a typo
cannot lock funds for centuries.

## 2. Keys

Two NFT collections, issued once by the owner through the contract
(`issueClaimKey`, `issueCancelKey`), with the contract holding the create and
burn roles. Proposed names: `MvxVestClaimKey` / `VESTKEY` and
`MvxVestCancelKey` / `VESTCANCEL`.

- Each vesting gets one claim key (sent to the beneficiary) and, if
  cancelable, one cancel key (sent to the creator). Amount 1, no royalties.
- A key keeps its nonce for life. The contract maps nonce to vesting id in its
  own storage and never reads the NFT's attributes.
- Name at mint: `Vesting #<id> claim key` (`Vesting #<id> claim key,
  cancelable` when the vesting can be cancelled, since version 3) and
  `Vesting #<id> cancel key`. Attributes:
  `tags:mvxvest,vesting;vesting:<id>;token:<token>;cancelable:<0|1>`, plus
  `;metadata:<value>` when the owner has set one. `cancelable:1` on a claim
  key warns a buyer that whoever holds the cancel key can stop the vesting; a
  cancel key always says `cancelable:1`. Keys minted by version 1 have no
  `cancelable` part. URIs: as set by the owner with `setKeyDisplay` for keys
  minted from then on.
- The stamp (version 3). The protocol lets only the holder change a
  non-dynamic NFT, so the contract can rewrite a claim key only while `claim`
  holds it. Each claim that pays and returns the key rewrites it with
  `ESDTMetaDataUpdate` (the contract holds `ESDTRoleNFTUpdate` on both
  networks): the name gets `, <p>% claimed` (`claimed` over the total, rounded
  down; `, under 1% claimed` below 1%) and the attributes get
  `;claimed:<units>` before the `metadata` part the key was minted with, if
  any. The key's URIs, nonce and royalties do not change. A claim that
  pays nothing leaves the key as it was; a key minted by version 1 or 2 is
  rewritten in the version 3 format at its first such claim. A cancel cannot
  be written: the contract does not hold the claim key then. A claim after a
  cancel always pays the rest and burns the key. The owner can turn
  the stamp off and on (`setKeyStamping`); it changes only what a key shows,
  never what a claim pays.

## 3. Endpoints

### `create(beneficiary, total, schedule, cancelable, label) -> id`

Payable. Pay exactly `total` plus the token fee of the token and the EGLD
fee in EGLD when it is not zero. For an EGLD vesting, pay all three in EGLD (as
plain value or as `EGLD-000000` in a multi-transfer; both work). The total is
an argument, not inferred from the payment, so a fee change between the
preview and the signature makes the transaction fail instead of changing the
vesting.

The two fees, both set by the owner under hard caps and both 0 until set:
- **The token fee** (`setTokenFee`): `total × bps / 10,000`, rounded down,
  in the vested token, at most 2% (200 bps). It is paid on top of the total
  and sent to the owner in the same transaction (`tokenFeePaid`). It never
  enters the contract's books, so the beneficiary gets exactly `total`.
- **The EGLD fee** (`setFee`): a flat amount per vesting, at most 1 EGLD. It
  is kept in the contract until the owner collects it with `claimFees`.

Refused when: creation is paused; the claim key collection (or the cancel key
collection, for a cancelable vesting) is not issued; nothing is paid; a
payment is not fungible; two different ESDTs are paid; the EGLD does not equal
the EGLD fee exactly or the payment is not exactly the total plus the fees; the
beneficiary is the zero address or the contract; the label
is longer than 64 bytes; the schedule is invalid (section 1); the schedule ends
more than 30 years ahead.

### `createBatch(cancelable, label, entries) -> ids`

Payable. `entries` is a list of `(beneficiary, total, schedule)`, 1 to 49 of
them (1 to 32 when cancelable: the network allows 100 built-in calls per
transaction; each vesting mints and sends one or two keys; the token fee
is one more transfer), all of the payment's token, all sharing `cancelable`
and `label`. Pay the sum of the totals plus each entry's token fee (rounded
down per entry, so a batch pays what single creations would) and the EGLD
fee times the number of entries. The same
checks as `create`, per entry. Returns the ids in entry order. Cancel keys go
to the creator in one transfer.

### `claim()`

Payable with one or more claim keys: at most 99 per transaction (each
finished key is burned and, since version 3, each key that paid and goes back
is stamped, a built-in call each; the network allows 100) and in practice
fewer, as each key costs about 7M gas, more with the stamp; the dApp sends at
most 50 and splits further when the network refuses a set. For each key: pays `vested(now) -
claimed` (with `vested` frozen at the cancel time, if cancelled), then returns
the key or burns it when nothing more can ever be claimed (`claimed` equals
the total or what had vested at the cancel). Each key that paid or burned
emits `vestingClaimed`; a key that paid nothing goes back unchanged, with no
event. Payouts of the same token are
merged into one transfer with the returned keys. Refused when a payment is not
a claim key minted by this contract or when no key paid anything or was
burned (`nothing to claim yet`): so claiming twice in one block pays once.

### `cancel()`

Payable with one or more cancel keys, at most 99 per transaction (each is
burned); the dApp sends at most 50. For each: sets `cancelled_at = now`,
pays `total - vested(now)` to the caller (whoever holds the key) and burns the
key. What had vested stays claimable with the claim key. Allowed at any time,
also after the end (refund 0). A non-cancelable vesting has no cancel key and
cannot be stopped.

### Owner endpoints

| Endpoint | Effect |
|---|---|
| `issueClaimKey(name, ticker)`, `issueCancelKey(name, ticker)` | Issue a collection once; pay the issue cost in EGLD |
| `disableKeyBurnByHolders(kind)` | Remove the protocol's default `ESDTRoleBurnForAll` from a key collection, so a holder cannot burn a key (a burned claim key would lock its vesting forever). Once per collection, after issuing |
| `setKeyDisplay(kind, metadata, uris...)` | How keys minted from now on look |
| `setFee(fee)` | Flat EGLD fee per vesting, at most 1 EGLD (`MAX_FEE_PER_VESTING`) |
| `setTokenFee(bps)` | Token fee, in basis points of each vesting's total, at most 200 (2%, `MAX_TOKEN_FEE_BPS`) |
| `pauseCreation()`, `unpauseCreation()` | Stop or resume `create` and `createBatch` only |
| `claimFees()` | Send the accrued EGLD fees to the owner |
| `setKeyStamping(on)` | Whether `claim` stamps the keys it returns (version 3; on unless turned off). Exists so a change of the protocol's metadata update can never stop claims until an upgrade |
| `recoverSurplus(token, to, [amount])` | Send `amount` of what the contract holds of `token` beyond what it owes. Without an amount, send all of it (see section 5) |
| `recoverBouncedKey(id, kind, to)` | Send on a key the contract holds after a bounce (below) |
| `upgrade` | The multisig can upgrade the contract; storage is kept |

### `recoverBouncedKey(id, kind, to)` (owner only)

Sends on the claim or cancel key (`kind`) of vesting `id` when the contract
itself holds it. That only happens when sending the key bounced: to a
beneficiary, creator or holder that is a smart contract that cannot receive
tokens from contracts (a wallet never bounces). The transaction that sent it
shows whom it belongs to (its transfer log or the contract's
`vestingCreated`/`vestingClaimed` events); the owner returns it there.
Nobody else can move a key the contract holds. One `keyRecovered` event per
key. Fails when the caller is not the owner, the vesting is unknown, the
contract does not hold that key or `to` is the zero address or the contract.

(Earlier versions let the creator recover some keys itself. All three reviews
found ways to abuse that: see [reviews/2026-10-12-contract.md](reviews/2026-10-12-contract.md).)

## 4. Views

`getVesting(id)` returns the vesting with its live state: `claimed`,
`cancelled_at`, `vested`, `claimable`, `final_amount` (the most the claim key
can ever collect), `refunded` and the `timestamp` used. Also: `getVestings(ids)`
(up to 100), `getClaimable(id)`, `getVestedAt(id, timestamp)`,
`getNextRelease(id)` (the next moment the vested amount grows and by how much,
exact for every curve; empty only when nothing more will vest: everything has
vested or the vesting was cancelled),
`getVestingByClaimNonce(nonce)`, `getVestingByCancelNonce(nonce)` (0 if no
key with that nonce was minted; the answer stays after the key is burned),
`getVestingsByCreator(address, from, count)`, `getVestingCountByCreator`,
`getVestingsByToken(token, from, count)`, `getVestingCountByToken`,
`getTokenTotals(token)` (deposited, claimed, refunded), `getVestingCount`,
`getFee`, `getMaxFee`, `getTokenFee`, `getMaxTokenFee`, `getFeesAccrued`,
`isCreationPaused`,
`getClaimKeyCollection`, `getCancelKeyCollection` (empty until issued),
`getSurplus(token)` and `getLimits`. Pages hold at most 100 ids. Since
version 3: `getClaimKeyStatus(nonce)` (the `getVesting` view of the vesting a
claim key opens, in one call; fails for a nonce never minted),
`getDeficit(token)` (what the balance lacks of what is owed: always 0, since
every payout is booked, while `getSurplus` stops at 0) and `isKeyStamping`.

## 5. Accounting and safety

- **Invariant:** for every token, the contract's balance equals `deposited -
  claimed - refunded` (plus the accrued fees, for EGLD). The tests check it
  after every step. `getSurplus` shows any difference.
- **Ordering:** every storage write happens before any transfer. Transfers
  carry no function call, so no code runs on the receiving side and nothing can
  re-enter.
- **Owner limits:** the owner cannot pause claims or cancels and has no
  endpoint that moves locked funds. `recoverSurplus` moves only the balance
  above what is owed. (As the contract is upgradeable, the multisig is trusted
  in any case; see [DECISIONS.md](DECISIONS.md).)
- **No dead ends:** every path ends claimable or refunded. A key that bounced
  can be recovered; a payout that bounced shows up as surplus and the owner
  can return it to whom the events show it belongs. So does a token fee the
  owner could not receive. (`tokenFeePaid` means sent: across shards, a
  bounce comes back later as surplus.) The owner must be payable by smart
  contracts. Otherwise every fee bounces; in the owner's own shard every
  fee-paying creation fails.
- **Tokens with special roles:** ESDT has no transfer fees, so the amount
  received is the amount sent. A token whose issuer can freeze, wipe or pause
  it (or that has a transfer role) can still be blocked by its issuer; the
  contract cannot detect this synchronously, so the dApp shows the issuer's
  powers on the vesting, token and create pages.
- **Code metadata:** deploy and upgrade the contract neither payable nor
  payable by smart contracts (`scripts/src/deploy.ts` does), so stray transfers
  without a call bounce. The contract cannot check this in `init` or `upgrade`
  (on the real chain those run before the new metadata is written). No money
  depends on it: a key, EGLD or a fungible token that reaches the contract
  outside an endpoint can be returned by the owner (`recoverBouncedKey`,
  `recoverSurplus`). Any other NFT, SFT or Meta ESDT could not be returned by
  anyone, which is one more reason to deploy non-payable.
- **Undelivered claim keys:** if the beneficiary cannot receive its key (a
  smart contract in another shard that is not payable by smart contracts), the
  key bounces back and the owner returns it to whom the creator and
  beneficiary agree. The dApp warns about smart contract beneficiaries before
  creating.
- **Smart contract holders:** a smart contract that holds a key must accept
  tokens from other contracts (`payableBySC`); otherwise the payout bounces (see
  "No dead ends"). The dApp warns when a beneficiary is a smart contract.

## 6. Events

`vestingCreated(id, creator, beneficiary, token; total, schedule, cancelable,
claim_nonce, cancel_nonce, label)`, `vestingClaimed(id, caller, token; amount,
claimed_total, finished)`, `vestingCancelled(id, caller, token; refund,
vested)`, `feeSet`, `tokenFeeSet(bps)`, `tokenFeePaid(token, to; amount)`,
`creationPaused`, `feesClaimed`, `keyRecovered(id, kind, caller, to)`,
`surplusRecovered`, `keyStampingSet(on)` (version 3). A stamp shows in the
claim's logs as the protocol's `ESDTMetaDataUpdate`. Indexed topics come before the semicolon. Together they
are enough to rebuild the full history without reading storage.
