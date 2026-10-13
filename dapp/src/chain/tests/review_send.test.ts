// Adversarial review: chain/send.ts, prepare() and send().
//
// 1. Gas: the simulated cost times 1.2 is capped at 600M (MAX_GAS), and then
//    a guarded account gets +50,000 on top: 600,050,000, above the network's
//    erd_max_gas_per_transaction (600,000,000 on devnet and mainnet), so the
//    node refuses it at send time. A cost the simulation reports above 600M is
//    also capped and called "would go through" (it can only run out of gas).
// 2. Several transactions: sdk-dapp's TransactionManager.send POSTs them in
//    parallel and rejects when any one POST fails. send() then reports the
//    whole set as not sent ("... did not go through: ...") and never tracks
//    or forgets anything, while the others are already in the mempool. A
//    retry builds every batch again: the accepted ones are created twice.

import { Address, Transaction } from '@multiversx/sdk-core';
import { MAX_GAS, prepare, send } from '../send';
import { explainWalletFailure } from '../walletFailure';

const SENDER = 'erd1qj8t37p66pkfswnyq434rme4c9c7a6qsexl6n6ggn0dt3zndf6cqr9lekl';
const GUARDIAN =
  'erd14e7zqk5qz47fu7z75rmvzrzt5cvmffe9n7s73679xt6khu09erksehgl4u';
const CONTRACT =
  'erd1qqqqqqqqqqqqqpgqak3uxq7z93x0rgjq5e47xvcmeuauukytf6cq26xfrp';
const NETWORK_MAX_GAS_PER_TX = 600_000_000n;

const estimateMock = jest.fn();
const apiMock = jest.fn();
const postMock = jest.fn();

jest.mock('../network', () => ({
  api: (path: string) => apiMock(path),
  forget: () => undefined,
  networkProvider: {
    getAccount: async () => ({ nonce: 42n }),
    estimateTransactionCost: (tx: unknown) => estimateMock(tx)
  }
}));
jest.mock(
  '@multiversx/sdk-dapp/out/store/actions/account/accountActions',
  () => ({ setAccountNonce: () => undefined })
);
// The real sdk-dapp TransactionManager, with axios answering per transaction.
jest.mock('axios', () => {
  const instance = {
    post: (...args: unknown[]) => postMock(...args),
    get: async () => ({ data: {} }),
    create: () => instance,
    isAxiosError: () => true,
    defaults: { headers: { common: {} } },
    interceptors: {
      request: { use: () => 0, eject: () => undefined },
      response: { use: () => 0, eject: () => undefined }
    }
  };
  return { __esModule: true, default: instance, ...instance };
});
jest.mock('lib', () => ({
  getAccountProvider: () => ({
    signTransactions: async (txs: unknown[]) => txs
  }),
  TransactionManager: jest.requireActual(
    '@multiversx/sdk-dapp/out/managers/TransactionManager/TransactionManager'
  ).TransactionManager
}));

const createTx = (nonce = 0n) =>
  new Transaction({
    sender: Address.newFromBech32(SENDER),
    receiver: Address.newFromBech32(CONTRACT),
    gasLimit: 0n,
    chainID: 'D',
    nonce,
    data: new TextEncoder().encode('createBatch@01@')
  });

beforeEach(() => {
  estimateMock.mockReset();
  apiMock.mockReset();
  postMock.mockReset();
});

describe('review: prepare() gas', () => {
  it('a guarded account never gets a gas limit above the network maximum', async () => {
    apiMock.mockResolvedValue({
      isGuarded: true,
      activeGuardianAddress: GUARDIAN
    });
    // A large batch: 520M simulated, 624M after the 1.2 margin, capped to 600M.
    estimateMock.mockResolvedValue({ gasLimit: 520_000_000 });
    const { transactions, problems } = await prepare(SENDER, [createTx()]);
    expect(problems).toEqual([null]);
    // Today: 600,050,000.
    expect(Number(transactions[0].gasLimit)).toBeLessThanOrEqual(
      Number(NETWORK_MAX_GAS_PER_TX)
    );
  });

  it('a simulated cost above the maximum is a problem, not "would go through"', async () => {
    apiMock.mockResolvedValue({ isGuarded: false });
    estimateMock.mockResolvedValue({ gasLimit: 700_000_000 });
    const { transactions, problems } = await prepare(SENDER, [createTx()]);
    expect(String(transactions[0].gasLimit)).toBe(String(MAX_GAS));
    // Today: null, and the transaction is offered for signing with 600M gas
    // for a call that needs 700M: it fails on chain and the fee is lost.
    expect(problems[0]).not.toBeNull();
  });
});

describe('review: send() with several transactions', () => {
  it('does not report a partly accepted set as "did not go through"', async () => {
    // Transaction 1 is accepted, transaction 2 is refused by the API.
    postMock.mockImplementation(async (_url: string, body: any) => {
      if (body.nonce === 42) return { data: { txHash: 'aa'.repeat(32) } };
      const error: any = new Error('Request failed with status code 429');
      error.response = { status: 429, data: { message: 'Too Many Requests' } };
      throw error;
    });
    let outcome: string;
    try {
      const { hashes } = await send(
        [createTx(42n), createTx(43n)],
        'Create 60 vestings'
      );
      outcome = `sent ${hashes.join(',')}`;
    } catch (failure) {
      outcome = explainWalletFailure(failure, 'Create 60 vestings');
    }
    // Today: "Create 60 vestings did not go through: Too Many Requests",
    // although transaction 1 (nonce 42) is in the mempool, untracked.
    expect(outcome).not.toMatch(/did not go through/);
    expect(outcome).toContain('aa'.repeat(32));
  });
});

describe('a guarded account (mainnet test, 13 Oct 2026)', () => {
  it('is simulated with its guardian named, or the network refuses to check it', async () => {
    apiMock.mockResolvedValue({
      isGuarded: true,
      activeGuardianAddress: GUARDIAN
    });
    const seen: { guardian: string; options: number }[] = [];
    estimateMock.mockImplementation(async (tx: Transaction) => {
      seen.push({ guardian: tx.guardian.toBech32(), options: tx.options });
      return { gasLimit: 10_000_000 };
    });
    const { transactions, problems } = await prepare(SENDER, [createTx()]);
    expect(problems).toEqual([null]);
    expect(seen).toEqual([{ guardian: GUARDIAN, options: 2 }]);
    // Still guarded when signed, with the guardian's extra gas.
    expect(transactions[0].guardian.toBech32()).toBe(GUARDIAN);
    expect(String(transactions[0].gasLimit)).toBe(
      String(12_000_000n + 50_000n)
    );
  });
});
