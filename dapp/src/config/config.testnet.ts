import { EnvironmentsEnum } from 'lib/sdkDapp/sdkDapp.types';

export * from './sharedConfig';

export const environment = EnvironmentsEnum.testnet;
/** The vesting contract on testnet (not deployed yet). */
export const contractAddress = '';
