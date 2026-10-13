import { ReactNode } from 'react';
import { Card, ExplorerLink, PageTitle } from 'components/ui';
import {
  contractAddress,
  contractCodeHashes,
  keyCollections,
  ownerMultisig,
  ownerQuorum
} from 'config';

const sections: [string, string][] = [
  [
    'What a vesting is',
    'Tokens locked in the mvxvest contract that become claimable over time for one beneficiary. One contract holds every vesting; each has a number, and anyone can read it.'
  ],
  [
    'Schedules',
    'A cliff (nothing before it, optionally a share unlocked at it), then the rest released every second, in equal steps every N days, on the same day every N months (the day in the creator’s own time zone) or on dates you choose. The last release absorbs any rounding, so the total vests exactly.'
  ],
  [
    'The two keys',
    'The beneficiary gets the claim key NFT; whoever holds it claims. A cancelable vesting gives its creator a cancel key NFT; sending it to the contract stops the vesting and returns what has not vested. Both keys can be moved like any NFT, and nobody can burn them except the contract.'
  ],
  [
    'What the contract owner can and cannot do',
    'The owner, a multisig, can set a small fee per vesting (capped at 1 EGLD in the code, paid by the creator, never by beneficiaries), pause the creation of new vestings and return keys or tokens that bounced back from a smart contract. In the code as it stands, it cannot pause claims or cancels and has no way to move locked tokens. The contract can be upgraded by the multisig, so a serious bug can be fixed, and an upgrade replaces the code: every promise on this page holds for the code as it is, and the rest is trust in the multisig and its signers. Each version is a reproducible build whose code hash anyone can check against the source.'
  ],
  [
    'Before you create',
    'Check every address: a vesting cannot be redirected, with one exception. A smart contract as beneficiary must be able to receive tokens from other contracts, or its key bounces back to the vesting contract, and the owner multisig sends it on to the address it decides. A token whose issuer can pause, freeze or wipe it can still be blocked by that issuer: the vesting and token pages show what each issuer can do.'
  ],
  [
    'Fees',
    'Each transaction pays the network fee, a fraction of a cent. Creating a vesting may also pay the contract fee, shown before you sign. Claiming and cancelling pay only the network fee.'
  ]
];

const Fact = ({
  label,
  path,
  small = false,
  children
}: {
  label: string;
  /** On the explorer. */
  path?: string;
  /** A long value (the 64-digit code hash) fits one line a size smaller. */
  small?: boolean;
  children: ReactNode;
}) => (
  <div>
    <dt className='text-xs text-muted'>
      {label}
      {path && (
        <>
          {' '}
          <ExplorerLink path={path}>explorer</ExplorerLink>
        </>
      )}
    </dt>
    <dd
      className={`mt-0.5 font-mono break-all ${small ? 'text-xs' : 'text-sm'}`}
    >
      {children}
    </dd>
  </div>
);

/**
 * The identifiers to compare against: a clone of the site, or a key from a
 * look-alike collection, differs in at least one of them (red team RT8).
 */
const Verify = () =>
  contractAddress ? (
    <Card className='md:col-span-2'>
      <h2 className='font-bold'>Check that it is the real mvxvest</h2>
      <dl className='mt-3 grid gap-4 sm:grid-cols-2'>
        <Fact label='Contract' path={`/accounts/${contractAddress}`}>
          {contractAddress}
        </Fact>
        <Fact label='Code hash (reproducible build)' small>
          {contractCodeHashes.join(', ')}
        </Fact>
        <Fact label='Claim keys' path={`/collections/${keyCollections.claim}`}>
          {keyCollections.claim}
        </Fact>
        <Fact
          label='Cancel keys'
          path={`/collections/${keyCollections.cancel}`}
        >
          {keyCollections.cancel}
        </Fact>
        <Fact label='Owner, a multisig' path={`/accounts/${ownerMultisig}`}>
          {ownerMultisig}
        </Fact>
        <Fact label='Owner quorum'>
          {ownerQuorum.signatures} of {ownerQuorum.signers} signatures
        </Fact>
      </dl>
      <p className='mt-3 text-sm text-muted'>
        A key from any other collection is not from mvxvest, whatever its name
        or picture. Every page compares the contract&apos;s code and owner with
        these and warns at the top if they differ.
      </p>
    </Card>
  ) : null;

export const Guide = () => (
  <div>
    <PageTitle title='How it works' />
    <div className='grid gap-4 md:grid-cols-2'>
      {sections.map(([title, text]) => (
        <Card key={title}>
          <h2 className='font-bold'>{title}</h2>
          <p className='mt-2 text-sm text-muted'>{text}</p>
        </Card>
      ))}
      <Verify />
    </div>
  </div>
);
