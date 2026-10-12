# mvxvest

Token vesting on MultiversX, on chain and claimable.

A project locks EGLD or any fungible ESDT in a vesting for its team, investors
or community. Each beneficiary receives an NFT, the **claim key**: whoever holds
it claims what has vested, so the position can move to a new wallet, a multisig
or a buyer. A cancelable vesting also gives its creator a **cancel key**:
sending it back stops the vesting, refunds what has not vested and leaves what
has vested claimable. Anyone can read every vesting without signing anything.

Status: **milestone 1**, the contract, in development on devnet. Private until
it is audited. The brief is in [docs/BRIEF.md](docs/BRIEF.md).

## Repository

| Path | What |
|---|---|
| [contracts/vesting/](contracts/vesting/) | The contract (Rust, `multiversx-sc` 0.66.2) and its tests |
| [scripts/](scripts/) | Deploy and interaction scripts for devnet, testnet and mainnet |
| [docs/](docs/) | Brief, contract spec, decisions, test map, measurements |
| `dapp/` | The web app (milestone 2) |

## The contract in one page

- **Schedules:** a cliff (a time and an optional amount unlocked at it), then
  the rest released linearly per second, in equal steps every N seconds, or as
  an explicit list of up to 120 tranches. Integer maths, rounding down, exact at
  the end. A start in the past is allowed (its vested part is claimable at
  once). [docs/CONTRACT_SPEC.md](docs/CONTRACT_SPEC.md) has the exact rules.
- **Keys:** one claim key per vesting, one cancel key per cancelable vesting.
  Both keep the same nonce for life; the contract finds the vesting from the
  nonce and never trusts NFT attributes.
- **Endpoints:** `create`, `createBatch` (up to 75 per transaction), `claim`
  (one or many keys), `cancel` (one or many keys).
- **Owner (a multisig):** issue the key collections, set how new keys look,
  set a flat EGLD fee per vesting (capped at 1 EGLD in code), pause creation
  (never claims or cancels), collect fees, and return keys or funds that
  bounced back. It can never move locked funds. The contract is upgradeable by
  the multisig.

## Build and test

Needs Rust (the toolchain is pinned in `rust-toolchain.toml`), and
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

CI also scans every push with gitleaks.

## Licence

GPL-3.0-only (see [LICENSE](LICENSE)), the licence of the MultiversX framework
the contract compiles in. Written from scratch; Pulsar Money's contract was
studied for ideas only.
