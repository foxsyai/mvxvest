import { useCallback } from 'react';
import { shortAddress } from 'components/ui';
import {
  getAccountProvider,
  UnlockPanelManager,
  useGetAccount,
  useGetIsLoggedIn
} from 'lib';
import { ALLOWED_WALLETS } from 'lib/sdkDapp/sdkDapp.constants';

// Connecting proves which address you are, nothing more: every action is a
// separate transaction your wallet shows and signs. The panel is built when the
// button is pressed, not on every render (mvxsafe, 6 Oct 2026).
export const ConnectButton = () => {
  const isLoggedIn = useGetIsLoggedIn();
  const { address } = useGetAccount();

  const open = useCallback(() => {
    UnlockPanelManager.init({
      allowedProviders: ALLOWED_WALLETS,
      loginHandler: () => undefined,
      onClose: async () => undefined
    }).openUnlockPanel();
  }, []);

  const disconnect = useCallback(async () => {
    await getAccountProvider().logout();
  }, []);

  if (!isLoggedIn) {
    return (
      <button
        type='button'
        onClick={open}
        title='Proves which address you are, with xPortal, the browser extension, a Ledger or the web wallet. It cannot move anything by itself.'
        className='rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-ink hover:opacity-90'
      >
        Connect
      </button>
    );
  }
  return (
    <span className='flex min-w-0 items-center gap-2'>
      <span
        className='truncate rounded-lg border border-line px-3 py-2 font-mono text-xs'
        title={address}
      >
        {shortAddress(address, 4)}
      </span>
      <button
        type='button'
        onClick={disconnect}
        aria-label='Disconnect'
        title='Disconnect this wallet from the page'
        className='shrink-0 rounded-lg border border-line p-2 text-muted hover:border-accent hover:text-ink'
      >
        <svg width='16' height='16' viewBox='0 0 24 24' fill='none' aria-hidden>
          <path
            d='M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9'
            stroke='currentColor'
            strokeWidth='1.8'
            strokeLinecap='round'
            strokeLinejoin='round'
          />
        </svg>
      </button>
    </span>
  );
};
