import { FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { vesting } from 'chain/vesting';
import { Card, inputClass } from 'components/ui';
import { useAsync } from 'hooks';

/** Where a lookup goes: an address, a token or a vesting number. */
export const lookupTarget = (raw: string): string | null => {
  const value = raw.trim();
  if (/^erd1[02-9ac-hj-np-z]{58}$/i.test(value))
    return `/a/${value.toLowerCase()}`;
  if (/^#?\d+$/.test(value)) return `/v/${value.replace('#', '')}`;
  if (/^EGLD$/i.test(value)) return '/t/EGLD-000000';
  if (/^[A-Z0-9]{3,10}-[0-9a-f]{6}$/i.test(value)) {
    const [ticker, suffix] = value.split('-');
    return `/t/${ticker.toUpperCase()}-${suffix.toLowerCase()}`;
  }
  return null;
};

export const Home = () => {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [problem, setProblem] = useState('');
  const count = useAsync(() => vesting.vestingCount(), []);

  const lookup = (event: FormEvent) => {
    event.preventDefault();
    const target = lookupTarget(query);
    if (target) navigate(target);
    else
      setProblem(
        'Enter an erd1 address, a token identifier such as FOXSY-123abc, or a vesting number.'
      );
  };

  return (
    <div className='space-y-10'>
      <section className='max-w-3xl'>
        <h1 className='text-3xl font-bold tracking-tight sm:text-4xl'>
          Token vesting on MultiversX, open to check.
        </h1>
        <p className='mt-4 text-lg text-muted'>
          Lock tokens for a team, investors or a community. Each beneficiary
          receives an NFT that is the key to claim what has vested. Anyone can
          look up a vesting, a token or an address, without a wallet.
        </p>
        <div className='mt-6 flex flex-wrap gap-3'>
          <Link
            to='/create'
            className='rounded-lg bg-accent px-5 py-2.5 text-sm font-semibold text-accent-ink hover:opacity-90'
          >
            Create vestings
          </Link>
          <Link
            to='/mine'
            className='rounded-lg border border-line bg-surface px-5 py-2.5 text-sm font-semibold hover:border-accent'
          >
            My vestings
          </Link>
        </div>
      </section>

      <Card>
        <form onSubmit={lookup} className='flex flex-col gap-3 sm:flex-row'>
          <input
            className={inputClass}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setProblem('');
            }}
            placeholder='Address (erd1...), token (FOXSY-123abc) or vesting number'
            aria-label='Look up an address, a token or a vesting'
          />
          <button
            type='submit'
            className='rounded-lg bg-accent px-5 py-2 text-sm font-semibold whitespace-nowrap text-accent-ink hover:opacity-90'
          >
            Look up
          </button>
        </form>
        {problem && <p className='mt-2 text-sm text-danger'>{problem}</p>}
        {count.data !== undefined && (
          <p className='mt-3 text-xs text-muted'>
            {count.data.toLocaleString('en-US')} vestings on this network so
            far.
          </p>
        )}
      </Card>

      <section className='grid gap-4 md:grid-cols-2'>
        <Card>
          <h2 className='text-lg font-bold'>The claim key</h2>
          <p className='mt-2 text-sm text-muted'>
            Every vesting has one NFT, sent to its beneficiary. Whoever holds it
            claims what has vested, so it can move to a new wallet, a multisig
            or a buyer, and the claim right moves with it. It keeps the same
            identity for its whole life.
          </p>
        </Card>
        <Card>
          <h2 className='text-lg font-bold'>The cancel key</h2>
          <p className='mt-2 text-sm text-muted'>
            A cancelable vesting gives its creator a second NFT. Sending it back
            stops the vesting at that moment: what has vested stays claimable
            with the claim key, the rest returns to whoever cancelled. A vesting
            created without it cannot be stopped by any key.
          </p>
        </Card>
      </section>
    </div>
  );
};
