import { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { vesting as client } from 'chain/vesting';
import { Card, ExplorerLink, PageTitle } from 'components/ui';
import {
  contractAddress,
  contractCodeHashes,
  keyCollections,
  ownerMultisig,
  ownerQuorum,
  ownerSigners,
  ownerSignersDistinct
} from 'config';
import { useAsync } from 'hooks';
import { percentOf } from 'vesting/fees';
import { formatAmount } from 'vesting/format';

// The public walkthrough: what a vesting is, then every screen in the order a
// creator and a beneficiary meet them, then what is worth knowing. The
// pictures are photographs of the live site taken by
// scripts/capture/guide.mjs on the test network, with test tokens; a person
// only connected the wallet and approved in it.

const Shot = ({ src, caption }: { src: string; caption: string }) => (
  <figure className='my-4'>
    <img
      src={`/shots/${src}.jpg`}
      alt={caption}
      loading='lazy'
      className='w-full rounded-xl border border-line'
    />
    <figcaption className='mt-2 text-xs text-muted'>{caption}</figcaption>
  </figure>
);

const Step = ({
  n,
  title,
  children
}: {
  n: number;
  title: string;
  children: ReactNode;
}) => (
  <section className='mt-10 flex gap-4'>
    <div className='flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-accent text-sm font-semibold text-accent'>
      {n}
    </div>
    <div className='min-w-0 flex-1'>
      <h3 className='text-lg font-semibold'>{title}</h3>
      <div className='mt-2 space-y-3 text-sm leading-relaxed text-muted'>
        {children}
      </div>
    </div>
  </section>
);

/** The fees as the contract has them now, read live. */
const Fees = () => {
  const { data } = useAsync(async () => {
    const [fee, bps] = await Promise.all([client.fee(), client.tokenFee()]);
    return { fee, bps };
  }, []);
  if (!data) return null;
  return (
    <>
      {' '}
      Today:{' '}
      <span className='font-semibold text-ink'>
        {data.bps > 0 ? `${percentOf(data.bps)} of each vesting` : 'no share'}{' '}
        and{' '}
        {data.fee > 0n
          ? `${formatAmount(data.fee, 18)} EGLD per vesting`
          : 'no EGLD fee'}
      </span>
      , read from the contract just now.
    </>
  );
};

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
        {ownerSigners.length > 0 && (
          <div className='sm:col-span-2'>
            <dt className='text-xs text-muted'>
              The owner&apos;s signers
              {ownerSignersDistinct &&
                `, ${ownerSigners.length} different people`}
            </dt>
            <dd className='mt-0.5 space-y-0.5 font-mono text-sm break-all'>
              {ownerSigners.map((signer) => (
                <div key={signer}>{signer}</div>
              ))}
            </dd>
          </div>
        )}
      </dl>
      <p className='mt-3 text-sm text-muted'>
        A key from any other collection is not from mvxvest, whatever its name
        or picture. Every page compares the contract&apos;s code and owner with
        these and warns at the top if they differ.
      </p>
    </Card>
  ) : null;

export const Guide = () => (
  <div className='mx-auto max-w-3xl'>
    <PageTitle title='How it works' />
    <p className='text-muted'>
      A vesting locks tokens in the mvxvest contract and releases them to one
      beneficiary over time. One contract holds every vesting; each has a number
      and anyone can read it. The beneficiary receives an NFT, the{' '}
      <b className='text-ink'>claim key</b>: whoever holds it claims what has
      vested, so the right to claim can move to another wallet, a multisig or a
      buyer. A vesting the creator may stop also gives the creator a{' '}
      <b className='text-ink'>cancel key</b>: sending it back stops the vesting
      at that moment. What has vested stays claimable; the rest returns.
    </p>
    <p className='mt-3 text-sm text-muted'>
      The pictures come from the test network, with test tokens (which have no
      registered logo, so the site marks them unverified). The real site works
      the same.
    </p>

    <h2 className='mt-10 text-xl font-bold'>Step by step</h2>

    <Step n={1} title='Look anything up, no wallet needed'>
      <p>
        Every vesting is public. Type a vesting number, a token or an address on
        the start page.
      </p>
      <Shot src='01-home' caption='The start page: one box for anything.' />
      <Shot
        src='02-vesting'
        caption='A vesting: what has vested and been claimed, the next release, the whole schedule, who holds each key and the history.'
      />
      <Shot
        src='03-token'
        caption='A token: every vesting of it and when the locked tokens unlock, month by month. This is how a community checks a team.'
      />
      <Shot
        src='04-address'
        caption='An address: the claim keys it holds and the vestings it created.'
      />
    </Step>

    <Step n={2} title='Connect your wallet'>
      <p>
        Connecting proves which address you are and signs nothing. Every action
        is a transaction that your wallet asks you to approve. xPortal, the
        browser extension, a Ledger and the web wallet all work, guarded
        accounts included.
      </p>
      <Shot
        src='05-connect'
        caption='The wallet chooser. xPortal shows a code to scan with the phone.'
      />
    </Step>

    <Step n={3} title='Choose the token'>
      <p>
        EGLD or any fungible token in your wallet. Check its identifier, not
        only its name: anyone can issue a token called like yours. If the
        token&apos;s issuer can still pause or freeze it, the page says so.
      </p>
      <Shot
        src='06-create-token'
        caption='Step 1 of Create: the token, with its identifier.'
      />
    </Step>

    <Step n={4} title='Add the beneficiaries'>
      <p>
        Type them one by one (an address and an amount per line) or load a CSV
        file of any length. Each line becomes its own vesting. A line is checked
        when you leave it; a smart contract as beneficiary gets a warning.
      </p>
      <Shot
        src='07-create-rows'
        caption='Three beneficiaries typed one by one.'
      />
      <Shot
        src='15-csv'
        caption='Sixty lines from a CSV: the page splits them into transactions the network accepts.'
      />
    </Step>

    <Step n={5} title='Choose the schedule'>
      <p>
        An optional cliff (nothing before it or a share unlocked at it), then
        the rest released every second, every N days, on the same day every N
        months or on dates you choose. The start may be in the past: what has
        vested since is claimable at once. The last release absorbs any
        rounding, so the total vests exactly. The chart and the table show every
        release before anything is signed.
      </p>
      <Shot
        src='08-schedule-linear'
        caption='Linear: a little more every second, until the end date.'
      />
      <Shot
        src='10-schedule-months'
        caption='A cliff in three months that unlocks 10%, then twelve monthly releases.'
      />
      <Shot
        src='09-schedule-dates'
        caption='On dates you choose, with the share of each.'
      />
    </Step>

    <Step n={6} title='Cancelable or not'>
      <p>
        A vesting that cannot be cancelled is the strongest promise: no key can
        stop it. A cancelable one gives you a cancel key per vesting. Everyone
        can see that it is cancelable, even on its claim key. A label helps you
        find it later.
      </p>
      <Shot src='11-options' caption='Cancelable, labelled Team 2027.' />
    </Step>

    <Step n={7} title='Review, check and sign'>
      <p>
        The review sums it all up, fees included. Check and sign asks the
        network to try every transaction first: a transaction it would refuse is
        never sent to your wallet. Several transactions are approved with one
        prompt.
      </p>
      <Shot
        src='12-review'
        caption='The review: how many vestings, what is locked, the fees and what you pay in all.'
      />
      <Shot
        src='13-checked'
        caption='Checked with the network: it would go through, at most this network fee.'
      />
      <Shot
        src='16-csv-checked'
        caption='Sixty vestings in two transactions, one approval in the wallet.'
      />
      <Shot
        src='14-created'
        caption='Created, as #604 to #606: the claim keys went to the beneficiaries and the cancel keys to you.'
      />
    </Step>

    <Step n={8} title='Claim'>
      <p>
        My vestings lists every vesting whose claim key is in your wallet. A
        linear vesting grows every second. Claim takes what has vested; Claim
        all takes it from every key at once. The key comes back to you or is
        burned once there is nothing left to pay.
      </p>
      <Shot
        src='17-mine'
        caption='My vestings: a filter by token, Claim all and Claim on each card.'
      />
      <Shot src='18-claimed' caption='After Claim all.' />
    </Step>

    <Step n={9} title='Move a claim key'>
      <p>
        The claim key is an ordinary NFT: send it from your wallet to another
        address and the right to claim goes with it. Whoever holds it now
        claims; nothing else changes. Before buying a claim key, look the
        vesting up here: it says whether someone holds a cancel key.
      </p>
    </Step>

    <Step n={10} title='Follow and cancel your vestings'>
      <p>
        Created by me lists every vesting you created and how far each
        beneficiary has got, with Export to CSV. Cancel appears wherever you
        hold the cancel key, also for one created elsewhere and sent to you.
        Cancelling stops the vesting at once and cannot be undone: what has
        vested stays claimable by the beneficiary; the rest comes back to you.
      </p>
      <Shot
        src='19-created'
        caption='Created by me: the progress of every beneficiary, Cancel where you hold the key.'
      />
      <Shot
        src='20-cancel'
        caption='Cancelling one vesting: what stays with the beneficiary and what comes back.'
      />
      <Shot
        src='21-cancelled'
        caption='The vesting afterwards: cancelled, with what was returned and what stays claimable.'
      />
    </Step>

    <h2 className='mt-12 text-xl font-bold'>Worth knowing</h2>
    <ul className='mt-3 list-disc space-y-3 pl-5 text-sm leading-relaxed text-muted'>
      <li>
        <b className='text-ink'>Fees.</b> Every transaction pays the network fee
        in EGLD, small and shown before you sign. Creating also pays two fees
        set by the owner multisig, both shown before you sign and both paid on
        top, so every beneficiary receives the full amount. One is a share of
        each vesting in its own token (at most 2% in the code), sent to the
        multisig at once. The other is a flat amount of EGLD per vesting (at
        most 1 EGLD).
        <Fees /> Claiming and cancelling pay only the network fee.
      </li>
      <li>
        <b className='text-ink'>What the owner can and cannot do.</b> The owner,
        a multisig, can set the fees on new vestings, pause the creation of new
        vestings and return keys or tokens that bounced back from a smart
        contract. It cannot pause claims or cancels and has no way to move
        locked tokens. It can upgrade the contract, so a serious bug can be
        fixed; every upgrade is a vote. Each version is a reproducible build
        whose code hash anyone can check (below).
      </li>
      <li>
        <b className='text-ink'>Smart contracts as beneficiaries.</b> A smart
        contract must accept tokens from other contracts and be able to send the
        key on. If it cannot, its key comes back to the vesting contract and the
        owner multisig sends it on: the one case in which a vesting can be
        redirected.
      </li>
      <li>
        <b className='text-ink'>The token&apos;s own issuer.</b> A token whose
        issuer can pause, freeze or wipe it can still be blocked by that issuer,
        whatever the vesting says. The vesting, token and create pages show what
        each issuer can do.
        <Shot
          src='22-issuer'
          caption="FOXSY's issuer can pause its transfers, add a transfer role and change these settings."
        />
      </li>
      <li>
        <b className='text-ink'>A transaction not found.</b> If the network does
        not confirm a transaction, the page keeps looking and signs nothing more
        behind it. Do not sign it again: it may still arrive. If it is not found
        for minutes, disconnect and connect your wallet again, then check the
        vesting before trying once more.
      </li>
      <li>
        <b className='text-ink'>Your keys never reach this site.</b> Every
        transaction is signed in your own wallet. The source is{' '}
        <a
          href='https://github.com/foxsyai/mvxvest'
          target='_blank'
          rel='noreferrer'
          className='text-accent hover:underline'
        >
          public
        </a>
        . The contract runs without this site:{' '}
        <Link to='/' className='text-accent hover:underline'>
          anyone can look it up
        </Link>
        .
      </li>
    </ul>

    <div className='mt-12'>
      <Verify />
    </div>
  </div>
);
