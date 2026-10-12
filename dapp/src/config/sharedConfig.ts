export const GITHUB_REPO_URL = 'https://github.com/foxsyai/mvxvest';
export const apiTimeout = 6000;
// No backend, so there is nothing to authenticate against: native auth only
// exists to prove an address to a server we do not have.
export const nativeAuth = false;

// WalletConnect 2 (Reown) project "mvxvest.io", team MvxVest. Its allowlist
// holds mvxvest.io and devnet.mvxvest.io: any other origin is refused, so a
// new host (testnet, a preview) must be added there first.
export const walletConnectV2ProjectId = '31f5d931d4dd6195188fcd218c96f07a';
