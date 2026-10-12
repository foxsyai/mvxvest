// Adversarial review: amounts shown with the wrong decimals or ticker when the
// token read is slow, fails, or belongs to the previous vesting.
//
// useToken returns 18 decimals and a ticker guessed from the identifier until
// /tokens/{id} answers, and for ever when it fails (429 after four tries, a
// timeout): `known: false` is never read by any page. useAsync also keeps the
// previous answer when the identifier changes, so a page that moves from one
// vesting to another (back/forward between /v/5 and /v/3) shows the new
// vesting's units with the old token's decimals and ticker until (or, on a
// failed read, unless) the new answer arrives.

import { act, render, renderHook, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { VestingCard } from 'components/vesting/VestingCard';
import type { Vesting } from 'vesting/client';
import { useToken } from '../useToken';

const tokenInfoMock = jest.fn();

jest.mock('chain/reads', () => ({
  EGLD_INFO: {
    identifier: 'EGLD-000000',
    ticker: 'EGLD',
    name: 'EGLD',
    decimals: 18
  },
  tokenInfo: (identifier: string) => tokenInfoMock(identifier)
}));
jest.mock('chain/network', () => ({
  explorerUrl: 'https://devnet-explorer.multiversx.com'
}));

const flush = async () => {
  for (let i = 0; i < 3; i++) await act(async () => undefined);
};

const usdcVesting: Vesting = {
  id: 7,
  creator: 'erd1qj8t37p66pkfswnyq434rme4c9c7a6qsexl6n6ggn0dt3zndf6cqr9lekl',
  beneficiary: 'erd14e7zqk5qz47fu7z75rmvzrzt5cvmffe9n7s73679xt6khu09erksehgl4u',
  token: 'USDC-c76f1f',
  // 1,000,000 USDC (6 decimals).
  total: 1_000_000_000_000n,
  schedule: {
    start: 1_800_000_000,
    cliff: 1_800_000_000,
    cliffAmount: 0n,
    end: 1_900_000_000,
    curve: { kind: 'linear' }
  },
  cancelable: false,
  createdAt: 1_800_000_000,
  claimNonce: 7,
  cancelNonce: 0,
  label: '',
  claimed: 0n,
  cancelledAt: 0,
  vested: 0n,
  claimable: 0n,
  finalAmount: 1_000_000_000_000n,
  refunded: 0n,
  timestamp: 1_800_000_000
};

beforeEach(() => tokenInfoMock.mockReset());

describe('review: token decimals on display', () => {
  it('a failed token read does not show 1,000,000 USDC as 0.000001 USDC', async () => {
    tokenInfoMock.mockRejectedValue(
      new Error('/tokens/USDC-c76f1f answered 429')
    );
    render(
      <MemoryRouter>
        <VestingCard vesting={usdcVesting} now={1_850_000_000} />
      </MemoryRouter>
    );
    await flush();
    // Today the card reads "0.000001 USDC" with no hint that the decimals
    // are a guess.
    expect(screen.queryByText('0.000001')).toBeNull();
  });

  it('after the identifier changes, a failed read does not keep the previous token', async () => {
    tokenInfoMock.mockImplementation(async (identifier: string) => {
      if (identifier === 'USDC-c76f1f')
        return { identifier, ticker: 'USDC', name: 'USDC', decimals: 6 };
      throw new Error(`/tokens/${identifier} answered 429`);
    });
    const { result, rerender } = renderHook((id: string) => useToken(id), {
      initialProps: 'USDC-c76f1f'
    });
    await flush();
    expect(result.current.ticker).toBe('USDC');

    rerender('WEGLD-a28c59');
    await flush();
    // Today: { identifier: 'USDC-c76f1f', ticker: 'USDC', decimals: 6,
    // known: true } for a WEGLD vesting, i.e. its amounts 10^12 times too big
    // and in the wrong ticker.
    expect(result.current.identifier).toBe('WEGLD-a28c59');
    expect(result.current.ticker).not.toBe('USDC');
  });
});
