import { vesting } from 'chain/vesting';
import { useAsync } from './useAsync';

/**
 * Whether the contract stamps the claim keys that claims return (version 3):
 * true or false once read; null for a contract without the stamp (version 2)
 * and while it is unknown (not read yet, or the read failed). What the site
 * says a key's name shows follows it (version 3's audit, V3R-1 and V3R-2).
 */
export const useKeyStamping = (): boolean | null => {
  const { data } = useAsync(async () => vesting.isKeyStamping(), []);
  return data ?? null;
};
