// Adversarial review: can the transactions TxPanel signs differ from the ones
// the page shows?
//
// TxPanel re-runs check() (build + prepare) every time its `build` prop
// changes. In Create.tsx `build` changes on every render of the page
// (`batches` is a new array each render), and the form stays editable while
// the panel is open. check() has no sequence guard, so:
//  1. an older check that answers after a newer one overwrites it, and the
//     Sign button then signs the OLD transactions under the NEW summary;
//  2. a re-render while the wallet prompt is open (sdk-dapp's
//     refreshAccount() updates the account store when signing starts, which
//     re-renders Create) throws the panel back to "checking" and then
//     "ready", offering Sign again while the first prompt is still open.

import { act, fireEvent, render, screen } from '@testing-library/react';
import { TxPanel } from '../TxPanel';

const prepareMock = jest.fn();
const sendMock = jest.fn();

jest.mock('chain/send', () => ({
  prepare: (...args: unknown[]) => prepareMock(...args),
  send: (...args: unknown[]) => sendMock(...args)
}));
jest.mock('chain/reads', () => ({
  outcomeOf: () => new Promise(() => undefined)
}));
jest.mock('chain/network', () => ({
  explorerUrl: 'https://devnet-explorer.multiversx.com'
}));

const fakeTx = (tag: string) =>
  ({ tag, data: new Uint8Array(10), gasLimit: 10_000_000n }) as any;

const flush = () => act(async () => undefined);

beforeEach(() => {
  prepareMock.mockReset();
  sendMock.mockReset();
});

describe('review: TxPanel signs what it shows', () => {
  it('signs the latest build even when an older check answers last', async () => {
    const pending: { txs: any[]; answer: () => void }[] = [];
    prepareMock.mockImplementation(
      (_sender: string, txs: any[]) =>
        new Promise((resolve) =>
          pending.push({
            txs,
            answer: () =>
              resolve({ transactions: txs, problems: txs.map(() => null) })
          })
        )
    );
    sendMock.mockResolvedValue({ hashes: ['h1'] });

    const buildA = () => Promise.resolve([fakeTx('A: cannot be cancelled')]);
    const buildB = () => Promise.resolve([fakeTx('B: cancelable')]);
    const panel = (summary: string, build: () => Promise<any[]>) => (
      <TxPanel
        sender='erd1sender'
        label='Create a vesting'
        summary={<p>{summary}</p>}
        build={build}
        onClose={() => undefined}
      />
    );

    const { rerender } = render(
      panel('Locks 1,000 TFOX in 1 vesting that nobody can cancel.', buildA)
    );
    await flush();
    // The creator changes their mind while the panel is open.
    rerender(
      panel('Locks 1,000 TFOX in 1 vesting that you can cancel.', buildB)
    );
    await flush();
    expect(pending).toHaveLength(2);

    // Network answers out of order: the newer check first, the older last.
    await act(async () => pending[1].answer());
    await act(async () => pending[0].answer());

    expect(screen.getByText(/that you can cancel/)).toBeTruthy();
    fireEvent.click(screen.getByText('Sign in your wallet'));
    await flush();

    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock.mock.calls[0][0].map((tx: any) => tx.tag)).toEqual([
      'B: cancelable'
    ]);
  });

  it('does not offer Sign again while the wallet prompt is still open', async () => {
    prepareMock.mockImplementation(async (_sender: string, txs: any[]) => ({
      transactions: txs,
      problems: txs.map(() => null)
    }));
    // The wallet prompt stays open.
    sendMock.mockImplementation(() => new Promise(() => undefined));

    // A new build function with the same content: what Create.tsx hands over
    // on every re-render (useCallback on a `batches` array rebuilt each time).
    const build = () => () => Promise.resolve([fakeTx('same content')]);
    const panel = (b: () => Promise<any[]>) => (
      <TxPanel
        sender='erd1sender'
        label='Create 120 vestings'
        summary={<p>Locks 120 vestings.</p>}
        build={b}
        onClose={() => undefined}
      />
    );

    const { rerender } = render(panel(build()));
    await flush();
    fireEvent.click(screen.getByText('Sign in your wallet'));
    await flush();
    expect(screen.getByText(/Waiting for your wallet/)).toBeTruthy();

    // The page re-renders (account store refreshed by sdk-dapp at signing).
    rerender(panel(build()));
    await flush();

    expect(screen.queryByText('Sign in your wallet')).toBeNull();
    expect(screen.getByText(/Waiting for your wallet/)).toBeTruthy();
    expect(prepareMock).toHaveBeenCalledTimes(1);
  });
});
