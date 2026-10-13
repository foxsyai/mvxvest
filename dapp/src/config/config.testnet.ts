import { EnvironmentsEnum } from 'lib/sdkDapp/sdkDapp.types';

export * from './sharedConfig';

export const environment = EnvironmentsEnum.testnet;
/** The vesting contract on testnet (not deployed yet). */
export const contractAddress = '';

/** What the guide shows and every page checks; see config.mainnet.ts. */
export const contractCodeHashes: string[] = [];
export const keyCollections = { claim: '', cancel: '' };
export const ownerMultisig: string = '';
export const ownerQuorum = { signatures: 0, signers: 0 };
export const ownerSigners: string[] = [];
/** The site may say the signers are different people. */
export const ownerSignersDistinct: boolean = false;
