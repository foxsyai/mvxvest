import { vesting } from 'chain/vesting';
import { useAsync } from './useAsync';

/**
 * How much less of a token the contract holds than it owes. `shortfall` is set
 * only when the contract says it is short; a read that failed is `failed`,
 * never "nothing is missing" (fifth audit, RT-3).
 */
export const useDeficit = (token: string | undefined) => {
  const { data, error } = useAsync(
    async () => (token ? vesting.deficit(token) : null),
    [token]
  );
  return {
    shortfall: data ? data : undefined,
    failed: Boolean(token && error && data === undefined)
  };
};
