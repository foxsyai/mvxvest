// The one vesting client the app uses: the configured contract, read through
// the app's queue and cache (chain/network.ts).

import { contractAddress } from 'config';
import { VestingClient } from 'vesting/client';
import { cached, chainId, networkProvider } from './network';

export const vesting = new VestingClient(
  contractAddress,
  networkProvider,
  chainId,
  cached
);
