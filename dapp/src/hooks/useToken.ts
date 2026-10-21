import { EGLD_INFO, TokenInfo, tokenInfo } from 'chain/reads';
import { useAsync } from './useAsync';

export type ShownToken = Omit<TokenInfo, 'decimals'> & {
  /** Unknown until the API has answered: amounts are not shown before. */
  decimals: number | undefined;
  known: boolean;
  /** The read failed: offer to try again. */
  failed: boolean;
  /**
   * The API answered that there is no such token (404): not an outage, so
   * no "try again" (fourth audit, RT1 and WEB-1).
   */
  missing: boolean;
  reload: () => void;
};

/**
 * A token's ticker and decimals. Until the API answers (or when it fails) the
 * decimals are unknown, never guessed: 1,000,000 USDC read with 18 decimals
 * would show as 0.000001.
 */
export const useToken = (identifier: string | undefined): ShownToken => {
  const { data, error, reload } = useAsync(
    // async: a read that throws at once is a failed read, never a crash.
    async () => (identifier ? tokenInfo(identifier) : EGLD_INFO),
    [identifier]
  );
  if (data)
    return { ...data, known: true, failed: false, missing: false, reload };
  return {
    identifier: identifier ?? '',
    ticker: identifier ? identifier.split('-')[0] : '',
    name: identifier ?? '',
    decimals: undefined,
    known: false,
    failed: Boolean(error),
    missing: (error as { status?: number } | undefined)?.status === 404,
    reload
  };
};
