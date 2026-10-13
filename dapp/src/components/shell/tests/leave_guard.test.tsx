// Create with transactions half done asks before an in-app link leaves it,
// and stays when the reader says no (backlog: "Warn before leaving Create").

import { act, fireEvent, render, screen } from '@testing-library/react';
import { createMemoryRouter, Link, RouterProvider } from 'react-router-dom';
import { LeaveGuard } from '../LeaveGuard';

// jsdom has no Fetch API, and a data router builds a Request for every
// navigation (browsers have one): just enough of it for navigations without
// loaders.
class StandInRequest {
  url: string;
  method: string;
  signal?: AbortSignal;
  constructor(input: string | URL, init: RequestInit = {}) {
    this.url = String(input);
    this.method = init.method ?? 'GET';
    this.signal = init.signal ?? undefined;
  }
}
beforeAll(() => {
  (global as any).Request ??= StandInRequest;
});

const app = (when: boolean) =>
  createMemoryRouter(
    [
      {
        path: '/create',
        element: (
          <>
            <LeaveGuard when={when} message='Leave anyway?' />
            <p>the create page</p>
            <Link to='/mine'>My vestings</Link>
          </>
        )
      },
      { path: '/mine', element: <p>my vestings page</p> }
    ],
    { initialEntries: ['/create'] }
  );

const leave = async (router: ReturnType<typeof app>) => {
  render(<RouterProvider router={router} />);
  await act(async () => {
    fireEvent.click(screen.getByText('My vestings'));
  });
};

afterEach(() => jest.restoreAllMocks());

it('stays when the reader says no', async () => {
  const confirm = jest.spyOn(window, 'confirm').mockReturnValue(false);
  await leave(app(true));
  expect(confirm).toHaveBeenCalledWith('Leave anyway?');
  expect(screen.getByText('the create page')).toBeTruthy();
});

it('leaves when the reader says yes', async () => {
  jest.spyOn(window, 'confirm').mockReturnValue(true);
  await leave(app(true));
  expect(screen.getByText('my vestings page')).toBeTruthy();
});

it('does not ask when nothing is half done', async () => {
  const confirm = jest.spyOn(window, 'confirm');
  await leave(app(false));
  expect(confirm).not.toHaveBeenCalled();
  expect(screen.getByText('my vestings page')).toBeTruthy();
});
