// Red team: one hostile dust key makes "Claim all" unusable, and the page
// cannot say which key is the cause.
//
// An attacker issues a token with canFreeze (or a transfer role), creates a
// 1-unit vesting of it for the victim and freezes the victim for that token.
// A claim that includes that key fails as a whole: the payout is one
// MultiESDTNFTTransfer (contracts/vesting/scenarios/audit_redteam_frozen_claim_all.scen.json
// on the Go VM). "Claim all" puts every claimable key in one transaction, the
// simulation refuses it, and TxPanel shows "The network would refuse this
// transaction" with the protocol's words, which name a token, not a vesting.
// A wallet with dozens of keys has no way to find the one to leave out, short
// of claiming one by one. The hostile key can never be burned (its vesting
// never finishes), so it stays until sent away.
//
// Expected once fixed: when the batch is refused, the page simulates per key
// and offers the ones that pass ("Claim all" minus the hostile key), or at
// least names the vesting that blocks the batch.

import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Mine } from '../Mine';

const T = 1_767_225_600;
const ALICE = 'erd1u05m7s9u4dthgzzgxd0795kaxpadhj93yv24nydjczw832a66qlsgw5esx';
const MALLORY =
  'erd1cn8w9h2gfks6fglhxcmfka5w98hym47s0w8r9y4nqq9syh3ddfvsr0ljwe';

const vesting = (over: Record<string, unknown>) => ({
  id: 1,
  creator: MALLORY,
  beneficiary: ALICE,
  token: 'FOX-a1b2c3',
  total: 1_000n,
  schedule: {
    start: T,
    cliff: T,
    cliffAmount: 0n,
    end: T + 1_000,
    curve: { kind: 'stepped', interval: 100 }
  },
  cancelable: false,
  createdAt: T,
  claimNonce: 1,
  cancelNonce: 0,
  label: '',
  claimed: 0n,
  cancelledAt: 0,
  vested: 500n,
  claimable: 500n,
  finalAmount: 1_000n,
  refunded: 0n,
  timestamp: T + 500,
  ...over
});
const real = vesting({ id: 1, claimNonce: 1, label: 'Salary' });
const hostile = vesting({
  id: 2,
  claimNonce: 2,
  token: 'EVIL-123456',
  total: 1n,
  vested: 1n,
  claimable: 1n,
  finalAmount: 1n,
  label: 'airdrop'
});

jest.mock('lib', () => ({
  useGetAccount: () => ({
    address: 'erd1u05m7s9u4dthgzzgxd0795kaxpadhj93yv24nydjczw832a66qlsgw5esx'
  }),
  useGetIsLoggedIn: () => true
}));
jest.mock('chain/network', () => ({
  explorerUrl: 'https://explorer.multiversx.com'
}));
jest.mock('chain/missing', () => ({
  MISSING_AFTER_MS: 120_000,
  lostSend: async () => undefined
}));
jest.mock('chain/send', () => ({
  // The network's simulation of the one transaction holding both keys.
  prepare: async (_sender: string, transactions: unknown[]) => ({
    transactions,
    problems: transactions.map(
      () => 'execution failed: ESDT token is frozen for EVIL-123456'
    )
  }),
  send: jest.fn()
}));
jest.mock('chain/reads', () => ({
  EGLD_INFO: {
    identifier: 'EGLD-000000',
    ticker: 'EGLD',
    name: 'EGLD',
    decimals: 18
  },
  tokenInfo: async (identifier: string) => ({
    identifier,
    ticker: identifier.split('-')[0],
    name: identifier,
    decimals: 0
  }),
  outcomeOf: async () => ({ status: 'pending' })
}));
jest.mock('chain/vesting', () => ({
  vesting: {
    collections: async () => ({
      claim: 'VESTKEY-f56bea',
      cancel: 'VESTCANCEL-ae94f5'
    }),
    claim: async () => ({ data: new Uint8Array(0), gasLimit: 0n })
  }
}));
jest.mock('chain/mine', () => ({
  claimableVestings: async () => [hostile, real]
}));

const flush = async () => {
  for (let i = 0; i < 6; i++) await act(async () => undefined);
};

describe('red team: Claim all with one hostile key among the claimable ones', () => {
  it('names the vesting that blocks it, or offers the rest', async () => {
    render(
      <MemoryRouter>
        <Mine />
      </MemoryRouter>
    );
    await flush();
    fireEvent.click(screen.getByText('Claim all (2)'));
    await flush();
    const refusal = screen.getByText(/would refuse/).closest('div');
    expect(refusal).not.toBeNull();
    const named = /#2|airdrop|vesting 2/i.test(refusal!.textContent ?? '');
    const rest = screen.queryByText(/Claim (all \(1\)|the rest|1 vesting)/i);
    expect(named || rest !== null).toBe(true);
  });
});
