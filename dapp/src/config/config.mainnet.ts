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

/**
 * What a reader can check the contract against, shown in the guide and
 * compared with the chain on every page (red team RT5, RT8).
 *
 * contractCodeHashes: every code hash this build accepts. Before an upgrade,
 * add the new build's hash and deploy the site; after it, remove the old one.
 */
export const contractCodeHashes = [
  // Version 2, live since 14 Oct 2026 (MAINNET.md). Version 1's fd32f4e1… was
  // removed after the upgrade.
  'a7acbf22b8fdd8f1e624dfd1354aacae4ccb20c0ef5974e1946704359bab718a',
  // Version 3 (CHANGELOG.md), listed before the multisig's vote; version 2's
  // hash goes once the upgrade is done.
  '65c689b9d0cefdc5e39e2d1f4e7110e0c3da787a8a56dbf163a3d59ce6e6101d'
];
export const keyCollections = {
  claim: 'VESTKEY-f56bea',
  cancel: 'VESTCANCEL-ae94f5'
};
export const ownerMultisig: string =
  'erd1qqqqqqqqqqqqqpgqe7jmywfkh74cam8uqnt762c54zuqgp6r6qlsul78u3';
export const ownerQuorum = { signatures: 2, signers: 3 };
/** The board: three different people (confirmed by Sebastian, 13 Oct 2026). */
export const ownerSigners = [
  'erd1u05m7s9u4dthgzzgxd0795kaxpadhj93yv24nydjczw832a66qlsgw5esx',
  'erd1cn8w9h2gfks6fglhxcmfka5w98hym47s0w8r9y4nqq9syh3ddfvsr0ljwe',
  'erd1q83m7yeunpjctjzyk6u30qfwphwvrg6ez0glcnar50s55dykcnqqr3s7j4'
];
/** The site may say the signers are different people. */
export const ownerSignersDistinct: boolean = true;
