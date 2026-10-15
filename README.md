# mvxvest

Token vesting on MultiversX, on chain and claimable.

A project locks EGLD or any fungible ESDT in a vesting for its team, investors
or community. Each beneficiary receives an NFT, the **claim key**: whoever holds
it claims what has vested, so the position can move to a new wallet, a multisig
or a buyer. A cancelable vesting also gives its creator a **cancel key**:
sending it back stops the vesting, refunds what has not vested and leaves what
has vested claimable. Anyone can read every vesting without signing anything.

Status:
- **Live on mainnet** since 12 Oct 2026, at [mvxvest.io](https://mvxvest.io).
  The contract is `erd1qqqqqqqqqqqqqpgqlzpdsymdk7zxekm9pvtpxja4gfx6trwluc2qgmllsu`,
  owned by a 2-of-3 mvxsafe multisig.
- **Version 2** since 14 Oct 2026.
- **Audited three times** by Claude Fable 5.1, in adversarial reviews:
  [first audit](docs/reviews/2026-10-13-fable-audit.md),
  [second audit](docs/reviews/2026-10-14-fable-audit-v2.md),
  [third audit](docs/reviews/2026-10-14-fable-audit-3.md) (what changed after the second).
- **Not yet announced.** The source has been public since 14 Oct 2026.
  More audit rounds come before the announcement.
- **Security:** report vulnerabilities privately, as [SECURITY.md](SECURITY.md)
  describes.

The brief is in
[docs/BRIEF.md](docs/BRIEF.md); the mainnet record in
[docs/MAINNET.md](docs/MAINNET.md); deploying in [docs/DEPLOY.md](docs/DEPLOY.md);
costs in [docs/MEASUREMENTS.md](docs/MEASUREMENTS.md).

## Repository

| Path | What |
|---|---|
| [contracts/vesting/](contracts/vesting/) | The contract (Rust, `multiversx-sc` 0.66.2) and its tests |
| [scripts/](scripts/) | Deploy and interaction scripts for devnet, testnet and mainnet |
| [docs/](docs/) | Brief, contract spec, decisions, test map, measurements |
| [dapp/](dapp/) | The web app, live at https://mvxvest.io (devnet build at https://devnet.mvxvest.io) |

## The contract in one page

- **Schedules:** a cliff (a time and an optional amount unlocked at it), then
  the rest released linearly per second, in equal steps every N seconds or as
  an explicit list of up to 120 tranches. Integer maths, rounding down, exact at
  the end. A start in the past is allowed (its vested part is claimable at
  once). [docs/CONTRACT_SPEC.md](docs/CONTRACT_SPEC.md) has the exact rules.
- **Keys:** one claim key per vesting, one cancel key per cancelable vesting.
  Both keep the same nonce for life; the contract finds the vesting from the
  nonce and never trusts NFT attributes.
- **Endpoints:** `create`, `createBatch` (up to 49 per transaction, 32 when cancelable), `claim`
  (one or many keys), `cancel` (one or many keys).
- **Owner (a multisig):** issue the key collections, set how new keys look,
  set the fees on new vestings (a share of each vesting in its own token, capped at 2% and sent to the multisig, plus a flat EGLD fee per vesting, capped at 1 EGLD), pause creation (never claims or cancels), collect fees and return keys or funds that bounced back. In the code as it stands it can never move locked funds. The contract is upgradeable by the multisig: an upgrade replaces the code.

## Build and test

Needs Rust (the toolchain is pinned in `rust-toolchain.toml`) and
`sc-meta` 0.66.2:

```sh
cargo install multiversx-sc-meta --version 0.66.2 --locked
```

If the install fails with `COMPILER BUG DETECTED` (the system `cc` is GCC 9),
prefix the commands with `CC=gcc-13 CXX=g++-13`.

```sh
cd contracts/vesting
sc-meta all build            # output/mvxvest.wasm, .abi.json, .mxsc.json
sc-meta all proxy            # regenerates src/proxy.rs after an interface change
cd ../..
sc-meta install mx-scenario-go   # once: the Go VM runner some tests use
cargo test -p mvxvest        # unit, property, blackbox and Go VM tests
cargo clippy -p mvxvest --all-targets -- -D warnings
```

[docs/TESTS.md](docs/TESTS.md) maps every rule of the brief to the tests that
check it.

What gets deployed is the reproducible build, made in the pinned Docker image
so anyone can rebuild it and compare the code hash with the one on chain:

```sh
sc-meta reproducible-build build --docker-image multiversx/sdk-rust-contract-builder:v12.0.0 \
  --project . --contract mvxvest --no-docker-interactive --no-docker-tty --overwrite
cat output-docker/mvxvest/mvxvest.codehash.txt
```

## Keys and secrets

Never commit keys, PEM files, mnemonics or `.env` files. Devnet keys live in
`~/.config/mvxvest/devnet/` (outside the repo, mode 600). Mainnet actions go
through the multisig (mvxsafe), never through a key on a laptop. After cloning,
enable the hook that refuses staged secrets:

```sh
git config core.hooksPath .githooks
```

CI also scans the history with gitleaks, on main and on every merge candidate.

## Contributing

Pull requests into `main` are welcome. When one is a candidate to merge, a maintainer adds the
label `merge-check`. That starts two checks, which must both pass. The pull request also needs a
maintainer's approval:

- **CI** (`mvxvest/ci`): the contract's build, tests and reproducible build; the dApp's lint,
  types, tests and build; a secret scan.
- **An AI review** (`mvxvest/review`): Claude Code reads the change, comments on what it finds and
  gives a verdict. A blocking finding keeps the pull request from merging.

Opening or updating a pull request starts nothing on its own. A commit pushed after the checks
needs the label again. A change to `.github/` or `scripts/ci/` is checked by hand. Report a security
issue through [SECURITY.md](SECURITY.md), never in a pull request.

## Licence

GPL-3.0-only (see [LICENSE](LICENSE)), the licence of the MultiversX framework
the contract compiles in. Written from scratch; Pulsar Money's contract was
studied for ideas only.
