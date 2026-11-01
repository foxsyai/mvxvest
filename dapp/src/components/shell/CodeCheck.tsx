// The contract can be upgraded by its owner multisig, and an upgrade replaces
// the code every Claim signs against. Every page checks that the code and the
// owner are still the ones this build was made for, and says so plainly when
// they are not (red team RT5). It checks again every few minutes and when the
// tab comes back, so a tab left open notices an upgrade, and it says when it
// could not check rather than looking like a check that passed (fourth audit,
// DT-3).

import { useEffect } from 'react';
import { api } from 'chain/network';
import { contractAddress, contractCodeHashes, ownerMultisig } from 'config';
import { useAsync } from 'hooks';

const RECHECK_MS = 5 * 60_000;

const hexOf = (base64: string) =>
  Array.from(atob(base64), (char) =>
    char.charCodeAt(0).toString(16).padStart(2, '0')
  ).join('');

export const CodeCheck = () => {
  const { data, error, reload } = useAsync(async () => {
    if (!contractAddress || contractCodeHashes.length === 0) return null;
    const account = await api<{ codeHash?: string; ownerAddress?: string }>(
      `/accounts/${contractAddress}`
    );
    return {
      code: account.codeHash ? hexOf(account.codeHash) : '',
      owner: account.ownerAddress ?? ''
    };
  }, []);
  useEffect(() => {
    const timer = setInterval(reload, RECHECK_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') reload();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [reload]);
  const codeChanged =
    Boolean(data?.code) && !contractCodeHashes.includes(data!.code);
  const ownerChanged =
    ownerMultisig !== '' && Boolean(data?.owner) && data!.owner !== ownerMultisig;
  // What is known to have changed comes first. Otherwise an answer without the
  // code or the owner checks nothing: changeOwnerAddress moves the owner
  // without touching the code (fifth audit, DAPP-2).
  if (
    !codeChanged &&
    !ownerChanged &&
    ((error && !data) ||
      data?.code === '' ||
      (ownerMultisig !== '' && data?.owner === ''))
  )
    return (
      <div
        role='status'
        className='bg-warn-soft px-4 py-1.5 text-center text-xs text-ink'
      >
        The vesting contract&apos;s code and owner could not be checked right
        now; they are checked again in a few minutes.
      </div>
    );
  if (!data || (!codeChanged && !ownerChanged)) return null;
  return (
    <div
      role='alert'
      className='bg-danger-soft px-4 py-2 text-center text-sm font-semibold text-danger'
    >
      {codeChanged
        ? "The vesting contract's code is not the one this site was built for: it was upgraded to code this site does not know."
        : "The vesting contract's owner is no longer the multisig named in How it works."}{' '}
      Do not sign anything until mvxvest.io explains the change.
    </div>
  );
};
