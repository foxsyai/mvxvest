export {
  ACCOUNTS_ENDPOINT,
  TRANSACTIONS_ENDPOINT
} from '@multiversx/sdk-dapp/out/apiCalls/endpoints';
export {
  GAS_PRICE,
  VERSION
} from '@multiversx/sdk-dapp/out/constants/mvx.constants';

/**
 * The wallets the connect panel offers: xPortal (WalletConnect), the DeFi
 * browser extension, a Ledger and the web wallet. MetaMask Snap runs in an
 * iframe our content policy does not allow, so it was offered and then failed
 * (ops audit OPS-09, 7 Oct 2026); passkey wallets are not offered for a tool
 * that moves treasuries.
 */
export const ALLOWED_WALLETS = [
  'walletConnect',
  'extension',
  'ledger',
  'crossWindow'
];
