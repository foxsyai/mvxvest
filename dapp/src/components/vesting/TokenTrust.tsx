// What a reader must know about a token before trusting a vesting of it: which
// token it really is, and what its issuer can still do to it. Neither is
// mvxvest's to change; both are the token's own settings.

import type { TokenInfo } from 'chain/reads';
import { AddressText, Info, Notice } from 'components/ui';

/**
 * The identifier, and "unverified" when the token has no registered assets:
 * anyone can issue a "FOXSY-abc123" whose ticker reads exactly like the real
 * FOXSY's (red team RT2).
 */
export const TokenId = ({
  token,
  className = ''
}: {
  token: Pick<TokenInfo, 'identifier' | 'verified'>;
  className?: string;
}) =>
  token.identifier === 'EGLD-000000' ? null : (
    <span
      className={`text-xs ${token.verified === false ? 'font-semibold text-warn' : 'text-muted'} ${className}`}
    >
      {token.verified === false
        ? `${token.identifier} · unverified`
        : token.identifier}
    </span>
  );

const join = (parts: string[]) =>
  parts.length < 2
    ? (parts[0] ?? '')
    : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;

/** What the issuer can do, in words; empty when it can do nothing. */
export const issuerPowers = (token: Omit<TokenInfo, 'decimals'>): string[] => {
  const powers: string[] = [];
  if (token.canPause) powers.push('pause all its transfers');
  if (token.canFreeze) powers.push('freeze any balance of it');
  if (token.canWipe) powers.push('wipe a frozen balance');
  if (token.canAddSpecialRoles) powers.push('add a transfer role');
  if (token.canUpgrade && powers.length > 0)
    powers.push('change these settings');
  else if (token.canUpgrade) powers.push('change its settings');
  return powers;
};

/**
 * The issuer's powers over the token, which the contract cannot prevent: a
 * "cannot be cancelled" vesting of a token its issuer can pause or wipe is
 * only as safe as that issuer (red team RT4).
 */
export const IssuerPowers = ({
  token
}: {
  token: Omit<TokenInfo, 'decimals'>;
}) => {
  const powers = issuerPowers(token);
  if (!token.isPaused && !token.transferRole && powers.length === 0)
    return null;
  return (
    <Notice tone={token.isPaused || token.transferRole ? 'danger' : 'warn'}>
      {token.isPaused && (
        <p className='font-semibold'>
          {token.ticker} is paused by its issuer: no claim or cancel of it can
          go through until it is unpaused.
        </p>
      )}
      {token.transferRole && (
        <p className='font-semibold'>
          {token.ticker} has a transfer role set: only the addresses its issuer
          chose can move it, which can stop this contract from paying.
        </p>
      )}
      {powers.length > 0 && (
        <p>
          The issuer of {token.ticker}
          {token.owner && (
            <>
              {' '}
              (<AddressText address={token.owner} />)
            </>
          )}{' '}
          can {join(powers)}.
          <Info label='What the issuer can do'>
            These are settings of the token itself, not of mvxvest, and the
            contract cannot prevent them. While a token is paused, claims and
            cancels of it wait. A frozen balance cannot move, and a wiped one is
            gone. A transfer role limits who may move the token. Many large
            tokens keep some of these powers: what matters is who holds them.
          </Info>
        </p>
      )}
    </Notice>
  );
};
