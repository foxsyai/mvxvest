import { useParams } from 'react-router-dom';
import { claimableVestings, createdVestings } from 'chain/mine';
import { vesting as client } from 'chain/vesting';
import {
  AddressText,
  ExplorerLink,
  Notice,
  PageTitle,
  ReadFailed,
  Spinner
} from 'components/ui';
import { VestingCard } from 'components/vesting/VestingCard';
import { useAsync } from 'hooks';

/** Any address, read-only: what it created and which claim keys it holds. */
export const Account = () => {
  const address = (useParams().address ?? '').toLowerCase();
  const data = useAsync(async () => {
    const collections = await client.collections();
    const [created, held] = await Promise.all([
      createdVestings(address),
      claimableVestings(address, collections.claim)
    ]);
    return { created, held };
  }, [address]);
  const now = Math.floor(Date.now() / 1000);

  return (
    <div className='space-y-6'>
      <PageTitle
        back
        title='Address'
        lead={
          <span className='flex flex-wrap items-center gap-2'>
            <AddressText address={address} link={false} />
            <ExplorerLink path={`/accounts/${address}`}>
              on the explorer
            </ExplorerLink>
          </span>
        }
      />
      {!/^erd1[02-9ac-hj-np-z]{58}$/.test(address) ? (
        <Notice tone='warn'>This is not a MultiversX address.</Notice>
      ) : data.error && !data.data ? (
        <ReadFailed
          what='this address'
          retry={data.reload}
          busy={data.loading}
        />
      ) : !data.data ? (
        <Spinner />
      ) : (
        <>
          <section className='space-y-3'>
            <h2 className='font-bold'>
              Claim keys it holds ({data.data.held.length})
            </h2>
            {data.data.held.length === 0 ? (
              <p className='text-sm text-muted'>None.</p>
            ) : (
              <div className='grid gap-4 lg:grid-cols-2'>
                {data.data.held.map((v) => (
                  <VestingCard key={v.id} vesting={v} now={now} />
                ))}
              </div>
            )}
          </section>
          <section className='space-y-3'>
            <h2 className='font-bold'>
              Vestings it created ({data.data.created.count})
            </h2>
            {data.data.created.count > data.data.created.list.length && (
              <p className='text-xs text-muted'>
                The newest {data.data.created.list.length} are listed.
              </p>
            )}
            {data.data.created.list.length === 0 ? (
              <p className='text-sm text-muted'>None.</p>
            ) : (
              <div className='grid gap-4 lg:grid-cols-2'>
                {data.data.created.list.map((v) => (
                  <VestingCard key={v.id} vesting={v} now={now} />
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
};
