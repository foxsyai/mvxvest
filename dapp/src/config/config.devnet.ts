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
/** The board: the devnet "owner" and "holder" test keys. */
export const ownerSigners = [
  'erd1qj8t37p66pkfswnyq434rme4c9c7a6qsexl6n6ggn0dt3zndf6cqr9lekl',
  'erd14e7zqk5qz47fu7z75rmvzrzt5cvmffe9n7s73679xt6khu09erksehgl4u'
];
/** The site may say the signers are different people. */
export const ownerSignersDistinct: boolean = false;
