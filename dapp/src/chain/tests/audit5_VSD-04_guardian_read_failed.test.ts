// Audit 5 (vest-dapp, VSD-04): when the guardian read fails, a guarded
// wallet's valid transaction is shown as refused by the network.
//
// prepare() reads /accounts/<address>?withGuardianInfo=true to name the
// guardian before the simulation (the network refuses to simulate a guarded
// account's transaction that does not name it: "not allowed to bypass
// guardian", mainnet test of 13 Oct 2026). guardianOf() turns ANY failure of
// that read (a 429 from the public API, a timeout) into '' (not guarded).
// The simulation is then refused, and TxPanel shows "The network would
// refuse this transaction, so nothing is sent: not allowed to bypass
// guardian" with Sign disabled: a false refusal of a valid claim, cancel or
// creation, for the guarded wallets the site explicitly supports (the mainnet
// test used guarded beneficiaries). The same wallet session knows its guardian:
// sdk-dapp keeps isGuarded and activeGuardianAddress in its account store
// and applies them itself at signing time.
//
// Expected once fixed: a failed guardian read falls back to the session's
// guardian (the transaction is simulated with it and passes), or at the
// least is reported as a read that failed ("try again"), never as the
// network refusing the transaction. The control passes today.

import { Address, Transaction } from '@multiversx/sdk-core';
import { getAccount } from '@multiversx/sdk-dapp/out/methods/account/getAccount';
import { setAccount } from '@multiversx/sdk-dapp/out/store/actions/account/accountActions';
import { loginAction } from '@multiversx/sdk-dapp/out/store/actions/sharedActions/sharedActions';
import { prepare } from '../send';

const SENDER = 'erd1qj8t37p66pkfswnyq434rme4c9c7a6qsexl6n6ggn0dt3zndf6cqr9lekl';
const GUARDIAN =
  'erd14e7zqk5qz47fu7z75rmvzrzt5cvmffe9n7s73679xt6khu09erksehgl4u';

const apiMock = jest.fn();
const estimateMock = jest.fn();

jest.mock('../network', () => ({
  api: (path: string) => apiMock(path),
  forget: () => undefined,
  networkProvider: {
    getAccount: async () => ({ nonce: 42n }),
    estimateTransactionCost: (tx: unknown) => estimateMock(tx)
  }
}));
jest.mock('../missing', () => ({
  MISSING_AFTER_MS: 120_000,
  lostSend: async () => undefined
}));
jest.mock('lib', () => ({
  getAccountProvider: () => ({}),
  TransactionManager: { getInstance: () => ({}) }
}));

const claimTx = () =>
  new Transaction({
    sender: Address.newFromBech32(SENDER),
    receiver: Address.newFromBech32(SENDER),
    gasLimit: 0n,
    chainID: 'D',
    nonce: 0n,
    data: new TextEncoder().encode('ESDTNFTTransfer@00@01@01@00@636c61696d')
  });

/** The network, as it answers a guarded account's simulation. */
const networkRule = async (tx: Transaction) => {
  if (!tx.guardian || tx.guardian.isEmpty())
    throw new Error(
      'Request error on url [transaction/cost]: [not allowed to bypass guardian]'
    );
  return { gasLimit: 10_000_000 };
};

beforeAll(() => {
  // The wallet session of a guarded account, as sdk-dapp keeps it after a
  // login: this is what the signing path itself uses.
  loginAction({ address: SENDER, providerType: 'extension' as any });
  setAccount({
    address: SENDER,
    nonce: 42,
    balance: '1000000000000000000',
    isGuarded: true,
    activeGuardianAddress: GUARDIAN,
    shard: 1,
    username: ''
  } as any);
});

beforeEach(() => {
  apiMock.mockReset();
  estimateMock.mockReset();
  estimateMock.mockImplementation(networkRule);
});

describe('VSD-04, control (passes today)', () => {
  it('with the guardian read answering, the transaction passes with its guardian', async () => {
    apiMock.mockResolvedValue({
      isGuarded: true,
      activeGuardianAddress: GUARDIAN
    });
    const { transactions, problems } = await prepare(SENDER, [claimTx()]);
    expect(problems).toEqual([null]);
    expect(transactions[0].guardian.toBech32()).toBe(GUARDIAN);
  });

  it('harness: the session knows the guardian', () => {
    expect(getAccount().isGuarded).toBe(true);
    expect(getAccount().activeGuardianAddress).toBe(GUARDIAN);
  });
});

describe('VSD-04: the guardian read fails (a 429 from the public API)', () => {
  it('is not shown as the network refusing a valid transaction', async () => {
    apiMock.mockRejectedValue(
      new Error('/accounts/erd1…?withGuardianInfo=true answered 429')
    );
    const outcome = await prepare(SENDER, [claimTx()]).then(
      (prepared) => ({ prepared }),
      (failure: unknown) => ({
        failure: String((failure as any)?.message ?? failure)
      })
    );
    if ('failure' in outcome) {
      // Acceptable: a read that failed, reported as such, so TxPanel offers
      // "Check again" instead of a refusal.
      expect(outcome.failure).not.toMatch(/bypass guardian/i);
      expect(outcome.failure).toMatch(/again|could not|guardian/i);
      return;
    }
    // Expected: simulated with the session's guardian, and it passes.
    // Today: problems[0] is "not allowed to bypass guardian".
    expect(outcome.prepared.problems).toEqual([null]);
    expect(outcome.prepared.transactions[0].guardian.toBech32()).toBe(GUARDIAN);
  });
});
