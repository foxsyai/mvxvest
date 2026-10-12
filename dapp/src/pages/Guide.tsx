import { Card, PageTitle } from 'components/ui';

const sections: [string, string][] = [
  [
    'What a vesting is',
    'Tokens locked in the mvxvest contract that become claimable over time for one beneficiary. One contract holds every vesting; each has a number, and anyone can read it.'
  ],
  [
    'Schedules',
    'A cliff (nothing before it, optionally a share unlocked at it), then the rest released every second, in equal steps every N days, on the same day every N months (the day in the creator’s own time zone), or on dates you choose. The last release absorbs any rounding, so the total vests exactly.'
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
    'Check every address: a vesting cannot be redirected. A smart contract as beneficiary must be able to receive tokens from other contracts, or its key bounces back and has to be returned by the owner. A token whose issuer can freeze or wipe it can still be blocked by that issuer.'
  ],
  [
    'Fees',
    'Each transaction pays the network fee, a fraction of a cent. Creating a vesting may also pay the contract fee, shown before you sign. Claiming and cancelling pay only the network fee.'
  ]
];

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
    </div>
  </div>
);
