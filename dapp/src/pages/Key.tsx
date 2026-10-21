import { Navigate, useParams } from 'react-router-dom';
import { vesting as client } from 'chain/vesting';
import { Notice, PageTitle, ReadFailed, Spinner } from 'components/ui';
import { keyCollections } from 'config';
import { useAsync } from 'hooks';
import { keyId, parseKeyId } from 'vesting/identifiers';

/**
 * A key's NFT identifier, pasted from a wallet or a marketplace
 * (VESTKEY-f56bea-07), leads to its vesting, where what was claimed and who
 * holds the cancel key are read live; a key of any other collection is said
 * not to be mvxvest's, whatever its name or picture (fourth audit, RT1).
 */
export const KeyPage = () => {
  const raw = useParams().key ?? '';
  const key = parseKeyId(raw);
  const kind =
    key?.collection === keyCollections.claim
      ? 'claim'
      : key?.collection === keyCollections.cancel
        ? 'cancel'
        : null;
  const found = useAsync(async () => {
    if (!key || !kind) return null;
    return kind === 'claim'
      ? client.vestingByClaimNonce(key.nonce)
      : client.vestingByCancelNonce(key.nonce);
  }, [raw]);

  if (found.data) return <Navigate to={`/v/${found.data}`} replace />;

  let body;
  if (!key)
    body = (
      <Notice tone='warn'>
        Not a key identifier. One looks like {keyId(keyCollections.claim, 7)}:
        the collection and the key&apos;s number.
      </Notice>
    );
  else if (!kind)
    body = (
      <Notice tone='warn'>
        Not an mvxvest key. mvxvest&apos;s claim keys are {keyCollections.claim}{' '}
        and its cancel keys {keyCollections.cancel}: a key from any other
        collection is not from mvxvest, whatever its name or picture.
      </Notice>
    );
  else if (found.error && !found.data)
    body = (
      <ReadFailed what='this key' retry={found.reload} busy={found.loading} />
    );
  else if (found.data === 0)
    body = (
      <Notice tone='warn'>
        No {kind} key with this number was ever made on this network.
      </Notice>
    );
  else body = <Spinner />;

  return (
    <div className='space-y-4'>
      <PageTitle back title='Key' />
      {body}
    </div>
  );
};
