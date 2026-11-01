// Audit 5 (vest-dapp, VSD-09): a simulation that could not run is shown as
// the network refusing the transaction.
//
// prepare() asks the network to simulate each transaction and, when that
// call throws for any reason, records the error text as the transaction's
// problem. TxPanel then shows "The network would refuse this transaction, so
// nothing is sent: <text>" with Sign disabled and no "Check again" (that
// button exists only in the error phase). A rate limit on /transaction/cost
// (the public API allows a visitor about two requests a second and a page
// start makes a dozen), a timeout, or a nonce complaint because the account
// moved between the nonce read and the simulation, are all shown as a
// definite refusal of a valid claim, cancel or creation. On Create the help
// text even sends the reader to look for a fee change. network.ts already
// exports isTransient() for exactly this distinction; send.ts does not use
// it. mvxsafe treats the nonce complaint as transient since 21 Oct 2026
// (TXN-05).
//
// Expected once fixed: a transient failure of the simulation is retried, or
// surfaces as "could not prepare it" with Check again; only the contract's
// or the protocol's own refusal is a problem of the transaction. The control
// passes today; the other two fail on 26b0d4c.

import { Address, Transaction } from '@multiversx/sdk-core';
import { prepare } from '../send';

const SENDER = 'erd1qj8t37p66pkfswnyq434rme4c9c7a6qsexl6n6ggn0dt3zndf6cqr9lekl';
const CONTRACT =
  'erd1qqqqqqqqqqqqqpgqak3uxq7z93x0rgjq5e47xvcmeuauukytf6cq26xfrp';

const estimateMock = jest.fn();

jest.mock('../network', () => ({
  api: async () => ({ isGuarded: false }),
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
jest.mock(
  '@multiversx/sdk-dapp/out/store/actions/account/accountActions',
  () => ({ setAccountNonce: () => undefined })
);
jest.mock('lib', () => ({
  getAccountProvider: () => ({}),
  TransactionManager: { getInstance: () => ({}) }
}));

const claimTx = () =>
  new Transaction({
    sender: Address.newFromBech32(SENDER),
    receiver: Address.newFromBech32(CONTRACT),
    gasLimit: 0n,
    chainID: 'D',
    nonce: 0n,
    data: new TextEncoder().encode('claim')
  });

/** A failure of the call itself, in sdk-core's words. */
const transport = (inner: string) =>
  new Error(`Request error on url [transaction/cost]: [${inner}]`);

const outcomeOf = (work: Promise<{ problems: (string | null)[] }>) =>
  work.then(
    (prepared) => ({ problems: prepared.problems }),
    (failure: unknown) => ({
      failure: String((failure as any)?.message ?? failure)
    })
  );

beforeEach(() => estimateMock.mockReset());

describe('VSD-09, control (passes today)', () => {
  it("the contract's own refusal is the transaction's problem", async () => {
    estimateMock.mockRejectedValue(
      new Error(
        'Request error on url [transaction/cost]: [execution failed: nothing to claim yet]'
      )
    );
    const { problems } = await prepare(SENDER, [claimTx()]);
    // (Today the reason keeps sdk-core's closing bracket, "nothing to claim
    // yet]": cosmetic, not asserted either way.)
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/nothing to claim yet/);
    expect(problems[0]).not.toMatch(/Request error|transaction\/cost/);
  });
});

describe('VSD-09: the simulation could not run', () => {
  it('a rate limit is not a refusal of the transaction', async () => {
    // The first two calls are refused by the API's rate limit; a third would
    // pass, as it does on the live API a second later.
    estimateMock
      .mockRejectedValueOnce(transport('Request failed with status code 429'))
      .mockRejectedValueOnce(transport('Request failed with status code 429'))
      .mockResolvedValue({ gasLimit: 10_000_000 });
    const outcome = await outcomeOf(prepare(SENDER, [claimTx()]));
    if ('failure' in outcome) {
      // Acceptable: reported as a check that could not be made.
      expect(outcome.failure).toMatch(/429|again|could not|not answer/i);
      return;
    }
    // Expected after a retry: it passes. Today: problems[0] names the 429.
    expect(outcome.problems).toEqual([null]);
  });

  it('a nonce complaint (the account moved since the nonce was read) is not a refusal', async () => {
    estimateMock
      .mockRejectedValueOnce(transport('lower nonce in transaction'))
      .mockResolvedValue({ gasLimit: 10_000_000 });
    const outcome = await outcomeOf(prepare(SENDER, [claimTx()]));
    if ('failure' in outcome) {
      expect(outcome.failure).toMatch(/nonce|again|could not/i);
      return;
    }
    expect(outcome.problems).toEqual([null]);
  });
});
