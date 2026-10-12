import { PropsWithChildren, useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { networkName } from 'chain/network';
import { useGetIsLoggedIn } from 'lib';
import {
  AddressChip,
  ConnectButton,
  DisconnectButton,
  useConnected
} from './ConnectButton';
import { Logo } from './Logo';
import { ThemeSwitch } from './ThemeSwitch';

// Set by vite.config.ts at build time; absent under jest.
declare const __MVXVEST_COMMIT__: string | undefined;
const COMMIT = typeof __MVXVEST_COMMIT__ === 'string' ? __MVXVEST_COMMIT__ : '';

const links = [
  { to: '/create', label: 'Create' },
  { to: '/mine', label: 'My vestings', needsWallet: true },
  { to: '/created', label: 'Created by me', needsWallet: true },
  { to: '/guide', label: 'How it works' }
];

const Nav = ({ onPick }: { onPick?: () => void }) => {
  const isLoggedIn = useGetIsLoggedIn();
  return (
    <>
      {links
        .filter((link) => !link.needsWallet || isLoggedIn)
        .map((link) => (
          <NavLink
            key={link.to}
            to={link.to}
            onClick={onPick}
            className={({ isActive }) =>
              `whitespace-nowrap text-sm font-semibold ${isActive ? 'text-accent' : 'text-muted hover:text-ink'}`
            }
          >
            {link.label}
          </NavLink>
        ))}
    </>
  );
};

export const Layout = ({ children }: PropsWithChildren) => {
  const [menu, setMenu] = useState(false);
  const connected = useConnected();
  return (
    <div className='flex min-h-screen flex-col'>
      {networkName !== 'mainnet' && (
        <div className='bg-warn-soft px-4 py-1 text-center text-[11px] font-semibold tracking-widest text-warn uppercase'>
          {networkName}: test network, no real money
        </div>
      )}
      <header className='border-b border-line bg-surface'>
        {/* Left: the logo, then the pages (desktop). Right: the theme, the
            address (desktop), the menu (phone) and, at the far right,
            disconnect or connect. On a phone the address gets a row of its
            own below. */}
        <div className='mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-4 py-3'>
          <Link to='/' className='shrink-0'>
            <Logo />
          </Link>
          <nav className='hidden items-center gap-5 md:flex'>
            <Nav />
          </nav>
          <div className='flex min-w-0 items-center gap-2'>
            <ThemeSwitch />
            {connected && (
              <span className='hidden md:flex'>
                <AddressChip />
              </span>
            )}
            <button
              type='button'
              className='shrink-0 rounded-lg border border-line p-2 text-muted hover:border-accent hover:text-ink md:hidden'
              onClick={() => setMenu((open) => !open)}
              aria-expanded={menu}
              aria-label='Menu'
            >
              <svg width='16' height='16' viewBox='0 0 24 24' aria-hidden>
                <path
                  d={menu ? 'M6 6l12 12M18 6L6 18' : 'M4 7h16M4 12h16M4 17h16'}
                  stroke='currentColor'
                  strokeWidth='1.8'
                  strokeLinecap='round'
                  fill='none'
                />
              </svg>
            </button>
            {connected ? <DisconnectButton /> : <ConnectButton />}
          </div>
        </div>
        {connected && (
          <div className='flex justify-end border-t border-line px-4 py-2 md:hidden'>
            <AddressChip />
          </div>
        )}
        {menu && (
          <nav className='flex flex-col gap-3 border-t border-line px-4 py-3 md:hidden'>
            <Nav onPick={() => setMenu(false)} />
          </nav>
        )}
      </header>
      <main className='mx-auto w-full max-w-6xl flex-grow px-4 py-8'>
        {children}
      </main>
      <footer className='border-t border-line bg-surface'>
        <div className='mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-5 text-xs text-muted'>
          <span>
            mvxvest, token vesting on MultiversX. Your keys never leave your
            wallet.
          </span>
          {/^[0-9a-f]{40}$/.test(COMMIT) && (
            <span
              className='font-mono'
              title='The commit this page was built from'
            >
              {COMMIT.slice(0, 7)}
            </span>
          )}
        </div>
      </footer>
    </div>
  );
};
