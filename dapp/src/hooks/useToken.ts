import { EGLD_INFO, TokenInfo, tokenInfo } from 'chain/reads';
import { useAsync } from './useAsync';

/** A token's ticker and decimals; EGLD's until the API answers. */
export const useToken = (
  identifier: string | undefined
): TokenInfo & { known: boolean } => {
  const { data } = useAsync(
    () => (identifier ? tokenInfo(identifier) : Promise.resolve(EGLD_INFO)),
    [identifier]
  );
  if (data) return { ...data, known: true };
  return {
    identifier: identifier ?? '',
    ticker: identifier ? identifier.split('-')[0] : '',
    name: identifier ?? '',
    decimals: 18,
    known: false
  };
};
