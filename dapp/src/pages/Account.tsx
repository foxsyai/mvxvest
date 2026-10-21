import { useState } from 'react';
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
import {
  KeyWindowNote,
  TokenFilter,
  VestingGrid
} from 'components/vesting/VestingList';
import { useAsync } from 'hooks';
import { isAddress } from 'vesting/identifiers';

/** Any address, read-only: what it created and which claim keys it holds. */
export const Account = () => {
  const address = (useParams().address ?? '').toLowerCase();
  const data = useAsync(async () => {
    // Nothing is asked of the API for text that is not an address.
    if (!isAddress(address)) return null;
    const collections = await client.collections();
    const [created, held] = await Promise.all([
      createdVestings(address),
      claimableVestings(address, collections.claim)
    ]);
    return { created, held, collections };
  }, [address]);
  const [tokenFilter, setTokenFilter] = useState<string | null>(null);
  const now = Math.floor(Date.now() / 1000);

  return (
    <div className='space-y-6'>
      <PageTitle
        back
        title='Address'
        lead={
          // Only an address is shown back: other text in the link is never
          // echoed (fourth audit, WEB-1).
          isAddress(address) && (
            <span className='flex flex-wrap items-center gap-2'>
              <AddressText address={address} link={false} />
              <ExplorerLink path={`/accounts/${address}`}>
                on the explorer
              </ExplorerLink>
            </span>
          )
        }
      />
      {!isAddress(address) ? (
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
            <KeyWindowNote
              address={address}
              collection={data.data.collections.claim}
              listed={data.data.held.length}
            />
            {data.data.held.length === 0 ? (
              <p className='text-sm text-muted'>None.</p>
            ) : (
              <>
                <TokenFilter
                  list={data.data.held}
                  value={tokenFilter}
                  onChange={setTokenFilter}
                />
                <VestingGrid
                  list={
                    tokenFilter
                      ? data.data.held.filter((v) => v.token === tokenFilter)
                      : data.data.held
                  }
                  now={now}
                />
              </>
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
              <VestingGrid list={data.data.created.list} now={now} />
            )}
          </section>
        </>
      )}
    </div>
  );
};
