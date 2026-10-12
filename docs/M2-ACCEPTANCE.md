# Milestone 2 acceptance: the dApp on devnet

Tested by Sebastian on 12 October 2026 at https://devnet.mvxvest.io, with real wallets. Every result below was checked on chain afterwards, not taken from the page.

| Wallet | Address |
|---|---|
| MultiversX DeFi Wallet (browser extension) | erd16pe79ay2m6g7ap9vpshvvqaqc3ayplwuqw0rkwj2gqvv0egn0wjsyzvjwd |
| xPortal (WalletConnect, Reown project "mvxvest.io") | erd1eg8syhxp8e0535zh8vny9z47f2esft2tm0m0a5wlhdgee8wx380s9kje85 |

Both wallets were set up with `scripts/src/tester.ts`: test tokens, plus four vestings covering every state a beneficiary meets.

| Flow | DeFi Wallet | xPortal |
|---|---|---|
| Connect | yes | yes, once the site had its own Reown project with mvxvest.io and devnet.mvxvest.io allowlisted |
| Claim one vesting | #326: 4,002.31 TFOX | #335: 4,000.76 TFOX |
| Claim all (a monthly vesting and a cancelled one; the spent key burns) | #327 + #328 | #336 + #337 |
| Cancel with a cancel key received from another wallet | #329: 1,930.16 TFOX back | #338 |
| Create, typed one by one, cancelable, then cancel one | #330, #331 (cancelled: 199.73 TFOX back) | #339 |
| Create from a CSV, monthly, not cancelable, one transaction | #332–#334 | |
| **Create from a CSV of 120 beneficiaries** | | **#340–#459: 4 transactions of 30, one wallet prompt. All 120 match the file line by line (beneficiary, amount, creator, token, cancelable), 7,266 TFOX in total, and 120 cancel keys in the creator's wallet.** |

## Found during the test and fixed the same day

- **My vestings failed for a wallet holding several claim keys.** sdk-core rewrote the query arguments in place. Fixed, and covered by a test against the real client.
- **A linear vesting kept showing in "Claim all" for a few seconds' worth right after a claim.** It now joins "Claim all" once 1% of it is claimable again, and its card says "grows every second".
- **Cancel keys received from another wallet had no list.** "Created by me" now shows them.
- **A card kept showing "Vesting" after a cancel.** Reads are now refreshed when a transaction's result is final.
- **Form validation was too eager.** A line is judged when you leave it, and missing fields are named plainly.
- **The last beneficiary line could not be removed.** Remove now empties it.
- **The CSV file picker was easy to miss.** It is now a button, with drop support and the file's name shown.
- Layout and copy:
  - cards in a row share their height, with buttons at the bottom;
  - a linear vesting shows "every second, until …";
  - linear checkpoints fall at round steps (by day for a week, by month for a year);
  - created ids show as ranges.
- **Branding.** The FOXSY orange of mvxsafe.io and the fox head with the key; the claim key NFT is green and the cancel key red.

## Still to check

- Light mode.
- The site on a phone.
- The lookups on the home page (a vesting number, a token, an address).
