import { useEffect, useRef, useState } from 'react';
import { PayoutBlock, payoutBlock } from 'chain/reads';

/** Per token: what stops it reaching the wallet, null for nothing, or unread. */
export type PayoutCheck = Record<string, PayoutBlock | 'unread' | null>;

const NOTHING_TO_CHECK: PayoutCheck = {};

/**
 * Reads, when a claim or cancel starts, whether the tokens it pays can reach
 * this wallet. `tokens` null: no such action now. `action` starts a new read
 * even for the same tokens. The answer stays as it was first read while the
 * action lasts: what was checked before signing does not change under the panel
 * when the page reloads after a transaction settles.
 */
export const usePayoutCheck = (
  wallet: string,
  tokens: string[] | null,
  action: unknown
) => {
  const key = tokens ? tokens.join(',') : null;
  const [answer, setAnswer] = useState<{
    wallet: string;
    action: unknown;
    key: string;
    check: PayoutCheck;
  } | null>(null);
  const [reading, setReading] = useState(false);
  const [asked, setAsked] = useState(0);
  const run = useRef(0);

  useEffect(() => {
    // Nothing to read now: what was read is forgotten and a read on its way no
    // longer counts. Vesting and Created open the same action with the same
    // token again, and an old answer would stand in for the new read: a token
    // frozen in between would reach Sign (fifth audit, merge gate's review).
    const id = ++run.current;
    if (!key) {
      setAnswer(null);
      setReading(false);
      return;
    }
    setReading(true);
    (async () => {
      const entries = await Promise.all(
        key.split(',').map(async (token) => {
          try {
            return [token, await payoutBlock(wallet, token)] as const;
          } catch {
            return [token, 'unread'] as const;
          }
        })
      );
      if (id !== run.current) return;
      setAnswer({ wallet, action, key, check: Object.fromEntries(entries) });
      setReading(false);
    })();
  }, [wallet, key, action, asked]);

  return {
    /** null until the read has answered. */
    check:
      key === null
        ? null
        : key === ''
          ? NOTHING_TO_CHECK
          : answer &&
              answer.wallet === wallet &&
              answer.key === key &&
              answer.action === action
            ? answer.check
            : null,
    reading,
    retry: () => setAsked((value) => value + 1)
  };
};

/** Each distinct token, in order. */
export const tokensOf = (vestings: { token: string }[]) => [
  ...new Set(vestings.map((v) => v.token))
];
