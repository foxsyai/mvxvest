import { EnvironmentsEnum } from 'lib/sdkDapp/sdkDapp.types';

export * from './sharedConfig';

export const environment = EnvironmentsEnum.mainnet;
/**
 * The vesting contract on mainnet: deployed 12 Oct 2026 from the reproducible
 * build (code hash fd32f4e161653fe2f5c5b673dc8f2786d718a21f4ec25b663c365afcf5a67d32),
 * keys VESTKEY-f56bea and VESTCANCEL-ae94f5, owned by the mvxsafe multisig
 * erd1qqqqqqqqqqqqqpgqe7jmywfkh74cam8uqnt762c54zuqgp6r6qlsul78u3 after the hand-over.
 */
export const contractAddress =
  'erd1qqqqqqqqqqqqqpgqlzpdsymdk7zxekm9pvtpxja4gfx6trwluc2qgmllsu';
