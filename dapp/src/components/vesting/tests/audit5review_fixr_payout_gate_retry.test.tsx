// Fifth audit, review of the fixes (FIXR): the gate before a claim or a cancel
// (PayoutGate, RT-1's layer 2). On a first answer of "frozen" the signature is
// held back behind "Go on anyway". After "Try again" the gate marks the reader
// as having insisted BEFORE the new answer arrives, so a "frozen" answer that
// comes back from the retry shows the signing panel at once, under the red
// notice, with no "Go on anyway" step, even when nothing was signed yet.

import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { PayoutCheck } from 'hooks';
import { PayoutGate } from '../PayoutCheck';

const TOKEN = 'FOX-a1b2c3';

const gate = (check: PayoutCheck | null, retry: () => void) => (
  <MemoryRouter>
    <PayoutGate
      check={check}
      token={TOKEN}
      action='claim'
      retry={retry}
      busy={false}
      onClose={() => undefined}
    >
      <button>Sign in your wallet</button>
    </PayoutGate>
  </MemoryRouter>
);

it('a frozen answer read first holds the signature back (pinned)', () => {
  render(gate({ [TOKEN]: 'frozen' }, () => undefined));
  expect(screen.getByText(/has frozen it for this wallet/)).toBeTruthy();
  expect(screen.queryByText('Sign in your wallet')).toBeNull();
  expect(screen.getByText('Go on anyway')).toBeTruthy();
});

it('a frozen answer after Try again holds the signature back the same way when nothing was signed', () => {
  const retry = jest.fn();
  const shown = render(gate({ [TOKEN]: 'unread' }, retry));
  // Unread: the panel is shown under the warning, as designed.
  expect(screen.getByText(/could not be checked/)).toBeTruthy();
  expect(screen.getByText('Sign in your wallet')).toBeTruthy();

  fireEvent.click(screen.getByText('Try again'));
  expect(retry).toHaveBeenCalledTimes(1);

  // The retry answers: the issuer has frozen the token for this wallet.
  shown.rerender(gate({ [TOKEN]: 'frozen' }, retry));
  expect(screen.getByText(/has frozen it for this wallet/)).toBeTruthy();
  // Expected: the same gate as on a first answer. Today: the panel and its
  // Sign button are on the page, and there is no "Go on anyway".
  expect(screen.queryByText('Sign in your wallet')).toBeNull();
  expect(screen.getByText('Go on anyway')).toBeTruthy();
});
