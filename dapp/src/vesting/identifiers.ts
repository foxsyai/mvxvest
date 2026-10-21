// The shapes of what a visitor can look up. A page checks the segment of its
// address against these before it reads anything or shows it: text that is
// not one of them is never echoed, so a link to the real site cannot carry a
// message of someone else's as the page's own heading (fourth audit, WEB-1).

export const isAddress = (value: string) =>
  /^erd1[02-9ac-hj-np-z]{58}$/.test(value);

export const isVestingNumber = (value: string) => /^[1-9]\d{0,15}$/.test(value);

export const isTokenId = (value: string) =>
  value === 'EGLD-000000' || /^[A-Z0-9]{3,10}-[0-9a-f]{6}$/.test(value);

/**
 * A key's NFT identifier as a wallet or a marketplace shows it, the
 * collection and the nonce in hexadecimal (VESTKEY-f56bea-07), so a buyer can
 * paste what they see (fourth audit, RT1).
 */
export const parseKeyId = (
  raw: string
): { collection: string; nonce: number } | null => {
  const match = /^([A-Z0-9]{3,10})-([0-9a-f]{6})-([0-9a-f]{2,13})$/i.exec(
    raw.trim()
  );
  if (!match) return null;
  const nonce = parseInt(match[3], 16);
  if (!Number.isSafeInteger(nonce) || nonce < 1) return null;
  return {
    collection: `${match[1].toUpperCase()}-${match[2].toLowerCase()}`,
    nonce
  };
};

/** The identifier's own spelling: an even number of hex digits, at least two. */
export const keyId = (collection: string, nonce: number) => {
  const hex = nonce.toString(16);
  return `${collection}-${hex.length % 2 ? `0${hex}` : hex}`;
};
