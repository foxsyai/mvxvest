import { useCallback, useState } from 'react';
import { shortAddress } from 'components/ui';
import {
  getAccountProvider,
  UnlockPanelManager,
  useGetAccount,
  useGetIsLoggedIn
} from 'lib';
import { ALLOWED_WALLETS } from 'lib/sdkDapp/sdkDapp.constants';

const iconStroke = {
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  fill: 'none'
};

// Connecting proves which address you are, nothing more: every action is a
// separate transaction your wallet shows and signs. The panel is built when the
// button is pressed, not on every render (mvxsafe, 6 Oct 2026).
export const ConnectButton = () => {
  const open = useCallback(() => {
    UnlockPanelManager.init({
      allowedProviders: ALLOWED_WALLETS,
      loginHandler: () => undefined,
      onClose: async () => undefined
    }).openUnlockPanel();
  }, []);
  return (
    <button
      type='button'
      onClick={open}
      title='Proves which address you are, with xPortal, the browser extension, a Ledger or the web wallet. It cannot move anything by itself.'
      className='shrink-0 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-ink hover:opacity-90'
    >
      Connect
    </button>
  );
};

/** The connected address, shortened; a click copies it in full. */
export const AddressChip = () => {
  const { address } = useGetAccount();
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1_500);
    } catch {
      // No clipboard (an old browser, a denied permission): nothing to show.
    }
  };
  return (
    <button
      type='button'
      onClick={copy}
      title={copied ? 'Copied' : `${address} (click to copy)`}
      aria-label={copied ? 'Address copied' : 'Copy your address'}
      className='flex min-w-0 items-center gap-2 rounded-lg border border-line px-3 py-2 font-mono text-xs hover:border-accent'
    >
      <span className='truncate'>{shortAddress(address, 4)}</span>
      <svg
        width='14'
        height='14'
        viewBox='0 0 24 24'
        aria-hidden
        className={copied ? 'text-ok' : 'text-muted'}
      >
        {copied ? (
          <path {...iconStroke} d='M5 12.5l4.5 4.5L19 7.5' />
        ) : (
          <g {...iconStroke}>
            <rect x='9' y='9' width='11' height='11' rx='2' />
            <path d='M5 15V6a2 2 0 0 1 2-2h9' />
          </g>
        )}
      </svg>
    </button>
  );
};

/** Disconnect: the door, always at the far right of the bar. */
export const DisconnectButton = () => {
  const disconnect = useCallback(async () => {
    await getAccountProvider().logout();
  }, []);
  return (
    <button
      type='button'
      onClick={disconnect}
      aria-label='Disconnect'
      title='Disconnect this wallet from the page'
      className='shrink-0 rounded-lg border border-line p-2 text-muted hover:border-accent hover:text-ink'
    >
      <svg width='16' height='16' viewBox='0 0 24 24' aria-hidden>
        <path
          {...iconStroke}
          d='M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9'
        />
      </svg>
    </button>
  );
};

/** Whether a wallet is connected, for the bar's layout. */
export const useConnected = () => useGetIsLoggedIn();
