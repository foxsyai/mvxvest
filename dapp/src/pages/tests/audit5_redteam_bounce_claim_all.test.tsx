// Fifth audit, red team (RT-1): one hostile dust key in "Claim all" sends a
// cross-shard wallet's real payout and every claim key it sent back into the
// contract.
//
// The contract is in shard 0. A wallet in shard 1 or 2 (two wallets in three)
// that claims N keys gets one MultiESDTNFTTransfer back: the tokens of every
// vesting and the keys that were not burned (claim.rs, `outgoing`, one
// `transfer_if_not_empty`). That transfer is carried to the wallet's shard as
// a smart contract result, after the contract has already booked every claim
// and stamped or burned every key. If the wallet is frozen for ONE of the
// tokens (the issuer of any token can freeze any address: a griefer issues
// EVIL with canFreeze, creates a 1-unit vesting of it for the victim, freezes
// the victim for EVIL), the whole transfer fails at the wallet
// (mx-chain-vm-common-go esdtDataStorage.go:250, ErrESDTIsFrozenForAccount)
// and the protocol returns everything to the sender, the contract
// (mx-chain-go process/smartContract/process.go, createSCRsWhenError:
// isCrossShardESDTTransfer rebuilds the MultiESDTNFTTransfer back to
// tx.SndAddr; the return carries ReturnMessage, so vmInput.go:113 sets
// ReturnCallAfterError and the contract's "not payable" does not stop it).
// The victim's real tokens are then surplus and the victim's real claim keys
// sit in the contract: only the owner multisig can return them, one key per
// vote (recoverBouncedKey) plus one for the tokens (recoverSurplus). The
// dApp's simulation runs only the hop it is given (transactionSimulator.go,
// ProcessTx), so nothing refuses the claim beforehand, and RT7's "blocking
// key" help never shows because the transaction succeeds.
//
// In shard 0 the same claim fails as a whole (the first audit's RT7 and
// scenarios/audit_redteam_frozen_claim_all.scen.json): the keys stay with the
// victim. Cross-shard the keys leave.
//
// The griefer pays: one token issue (0.05 EGLD), one dust vesting (0.1 EGLD
// plus gas), one freeze (gas). The victim's keys are "worth claiming" for the
// dust key too (describe.ts: any non-linear curve with something claimable),
// so "Claim all" takes it along.
//
// Expected once fixed: "Claim all" never puts keys of different tokens into
// one transaction, so a token that cannot reach the wallet takes only its own
// key and tokens back (one claim per token; the keys of one token can only be
// refused together anyway). Then a hostile token can bounce only itself.

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
const salary = vesting({ id: 1, claimNonce: 1, label: 'Salary' });
const bonus = vesting({ id: 2, claimNonce: 2, label: 'Bonus' });
const hostile = vesting({
  id: 3,
  claimNonce: 3,
  token: 'EVIL-123456',
  total: 1n,
  vested: 1n,
  claimable: 1n,
  finalAmount: 1n,
  label: 'airdrop'
});

const claimCalls: number[][] = [];

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
  // The simulation passes: the failing hop (the payout reaching the wallet)
  // is never simulated.
  prepare: async (_sender: string, transactions: unknown[]) => ({
    transactions,
    problems: transactions.map(() => null)
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
  keysCount: async () => 3,
  tokenInfo: async (identifier: string) => ({
    identifier,
    ticker: identifier.split('-')[0],
    name: identifier,
    decimals: 0,
    verified: identifier.startsWith('FOX')
  }),
  outcomeOf: async () => ({ status: 'pending' })
}));
jest.mock('chain/vesting', () => ({
  vesting: {
    collections: async () => ({
      claim: 'VESTKEY-f56bea',
      cancel: 'VESTCANCEL-ae94f5'
    }),
    claim: async (_address: string, _collection: string, nonces: number[]) => {
      claimCalls.push([...nonces]);
      return { data: new Uint8Array(0), gasLimit: 0n };
    }
  }
}));
jest.mock('chain/mine', () => ({
  claimableVestings: async () => [hostile, bonus, salary]
}));

const flush = async () => {
  for (let i = 0; i < 8; i++) await act(async () => undefined);
};

describe('red team: Claim all with a hostile dust key, from a wallet in another shard', () => {
  it('never puts the keys of another token into the transaction that carries the dust key', async () => {
    render(
      <MemoryRouter>
        <Mine />
      </MemoryRouter>
    );
    await flush();
    fireEvent.click(screen.getByText('Claim all (3)'));
    await flush();
    expect(claimCalls.length).toBeGreaterThan(0);
    // The transaction that carries the EVIL key (nonce 3) must carry no FOX
    // key (nonces 1 and 2): one claim per token.
    const withDust = claimCalls.filter((nonces) => nonces.includes(3));
    expect(withDust.length).toBe(1);
    expect(withDust[0]).toEqual([3]);
    // And every FOX key is still claimed, in a transaction of its own token.
    const fox = claimCalls.filter((nonces) => !nonces.includes(3)).flat();
    expect([...fox].sort()).toEqual([1, 2]);
  });
});
