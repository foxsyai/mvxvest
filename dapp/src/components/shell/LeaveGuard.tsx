import { useContext, useEffect } from 'react';
import { UNSAFE_DataRouterContext, useBlocker } from 'react-router-dom';

const Blocker = ({ when, message }: { when: boolean; message: string }) => {
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      when && currentLocation.pathname !== nextLocation.pathname
  );
  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    if (window.confirm(message)) blocker.proceed();
    else blocker.reset();
  }, [blocker, message]);
  return null;
};

/**
 * Asks before an in-app link (a menu item, the logo, a card) leaves the page
 * while `when` holds; a reload or a closed tab is the page's own beforeunload.
 * Does nothing outside a data router (the tests' MemoryRouter).
 */
export const LeaveGuard = (props: { when: boolean; message: string }) =>
  useContext(UNSAFE_DataRouterContext) ? <Blocker {...props} /> : null;
