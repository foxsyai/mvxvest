# Security

mvxvest holds other people's tokens, so a vulnerability report matters more
than anything else here.

## Reporting

Please report privately, never in a public issue: use **Report a
vulnerability** on this repository's Security tab (GitHub's private
vulnerability reporting). Include what an attacker can do, and the steps or a
test that shows it. We answer within a few days and credit you if you wish.

## What is in scope

- The contract in `contracts/vesting`, live on MultiversX mainnet at
  `erd1qqqqqqqqqqqqqpgqlzpdsymdk7zxekm9pvtpxja4gfx6trwluc2qgmllsu`.
- The site in `dapp/`, served at https://mvxvest.io.
- The owner tooling in `scripts/` and the procedures in `docs/DEPLOY.md`.

## What has been reviewed

Two adversarial audits by Claude Fable 5.1, in `docs/reviews/`. Each finding
was proven by a test and fixed; the proofs are the `audit_*` and `audit2_*`
tests. The deployed code is a reproducible build: rebuild it with the command
in `README.md` and compare the code hash with the one on chain.
