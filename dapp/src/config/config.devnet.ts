import { EnvironmentsEnum } from 'lib/sdkDapp/sdkDapp.types';

export * from './sharedConfig';

export const environment = EnvironmentsEnum.devnet;
/** The vesting contract on devnet. */
export const contractAddress =
  'erd1qqqqqqqqqqqqqpgqak3uxq7z93x0rgjq5e47xvcmeuauukytf6cq26xfrp';

/** What the guide shows and every page checks; see config.mainnet.ts. */
export const contractCodeHashes = [
  'fd32f4e161653fe2f5c5b673dc8f2786d718a21f4ec25b663c365afcf5a67d32'
];
export const keyCollections = {
  claim: 'VESTKEY-8f217c',
  cancel: 'VESTCANCEL-bd731d'
};
export const ownerMultisig: string =
  'erd1qqqqqqqqqqqqqpgqyhjacmc59pem8ywgu9e5met6l49mst7lerksrtaq6e';
export const ownerQuorum = { signatures: 2, signers: 2 };
