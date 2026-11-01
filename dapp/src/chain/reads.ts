// Reads from the public API: what a wallet holds (keys, tokens, EGLD), what a
// token is, and the history of a vesting from the contract's events. Nothing
// here signs or sends.

import { Address } from '@multiversx/sdk-core';
import { contractAddress } from 'config';
import { EGLD } from 'vesting/client';
import { api, fresh, freshGateway } from './network';

export interface TokenInfo {
  identifier: string;
  ticker: string;
  name: string;
  decimals: number;
  /** Logo, when the token has registered assets. */
  icon?: string;
  /**
   * The token has registered assets (a logo and a description reviewed by
   * MultiversX). A look-alike "FOXSY-abc123" has none, and its ticker reads
   * exactly like the real FOXSY's (red team RT2).
   */
  verified?: boolean;
  /** Who can change the token, and what they can still do to every balance. */
  owner?: string;
  isPaused?: boolean;
  canPause?: boolean;
  canFreeze?: boolean;
  canWipe?: boolean;
  canAddSpecialRoles?: boolean;
  canUpgrade?: boolean;
  canChangeOwner?: boolean;
  /** A transfer role is set: only the addresses holding it can move the token. */
  transferRole?: boolean;
}

/** "TFOX" from "TFOX-d61b09": the API's ticker is the full id when a token has no assets. */
const tickerOf = (ticker: string | undefined, identifier: string) =>
  (ticker || identifier).split('-')[0];

export const EGLD_INFO: TokenInfo = {
  identifier: EGLD,
  ticker: 'EGLD',
  name: 'EGLD',
  decimals: 18,
  verified: true
};

/** What the API knows about a fungible token; EGLD needs no call. */
export const tokenInfo = async (identifier: string): Promise<TokenInfo> => {
  if (identifier === EGLD || identifier === 'EGLD') return EGLD_INFO;
  const token = await api<any>(`/tokens/${identifier}`);
  return {
    identifier,
    ticker: tickerOf(token.ticker, identifier),
    name: token.name ?? identifier,
    decimals: Number(token.decimals ?? 0),
    icon: token.assets?.svgUrl ?? token.assets?.pngUrl,
    verified: Boolean(token.assets),
    owner: token.owner,
    isPaused: token.isPaused === true,
    canPause: token.canPause === true,
    canFreeze: token.canFreeze === true,
    canWipe: token.canWipe === true,
    canAddSpecialRoles: token.canAddSpecialRoles === true,
    canUpgrade: token.canUpgrade === true,
    canChangeOwner: token.canChangeOwner === true,
    // The protocol's ESDTTransferRole; matched loosely, as the API's names
    // of roles vary (ESDTRoleLocalBurn, ESDTRoleBurnForAll).
    transferRole: (token.roles ?? []).some((entry: any) =>
      (entry?.roles ?? []).some((role: string) => /transfer/i.test(role))
    )
  };
};

export interface Balance extends TokenInfo {
  balance: bigint;
}

/** EGLD and every fungible token an address holds, largest first by name. */
export const balancesOf = async (address: string): Promise<Balance[]> => {
  const [account, tokens] = await Promise.all([
    api<any>(`/accounts/${address}`),
    api<any[]>(`/accounts/${address}/tokens?size=500&includeMetaESDT=false`)
  ]);
  const list: Balance[] = [
    { ...EGLD_INFO, balance: BigInt(account.balance ?? '0') }
  ];
  for (const token of tokens ?? []) {
    if (token.type && token.type !== 'FungibleESDT') continue;
    list.push({
      identifier: token.identifier,
      ticker: tickerOf(token.ticker, token.identifier),
      name: token.name ?? token.identifier,
      decimals: Number(token.decimals ?? 0),
      icon: token.assets?.svgUrl ?? token.assets?.pngUrl,
      balance: BigInt(token.balance ?? '0')
    });
  }
  return list;
};

const hexOf = (n: number) => {
  const hex = n.toString(16);
  return hex.length % 2 ? `0${hex}` : hex;
};

/** How far the API pages (its search window): from + size at most this. */
const API_WINDOW = 10_000;
/** Past the window, how many of the newest keys are asked about by name. */
const NEWEST_CHECKED = 2_000;

/** How many keys of `collection` `address` holds. */
export const keysCount = (address: string, collection: string) =>
  collection
    ? api<number>(`/accounts/${address}/nfts/count?collections=${collection}`)
    : Promise.resolve(0);

/**
 * Nonces of the keys of `collection` that `address` holds. The API lists them
 * oldest first and refuses to page past 10,000, which anyone can reach by
 * sending a wallet dust vestings (red team RT1): past it, the keys of the
 * newest vestings (up to `newestNonce`) are asked about by name, and the rest
 * cannot be listed.
 */
export const keysHeld = async (
  address: string,
  collection: string,
  newestNonce?: number
): Promise<number[]> => {
  if (!collection) return [];
  const nonces = new Set<number>();
  let full = false;
  for (let from = 0; ; from += 100) {
    if (from + 100 > API_WINDOW) {
      full = true;
      break;
    }
    const page = await api<{ nonce: number }[]>(
      `/accounts/${address}/nfts?collections=${collection}&from=${from}&size=100&fields=nonce`
    );
    page.forEach((nft) => nonces.add(nft.nonce));
    if (page.length < 100) break;
  }
  if (full && newestNonce) {
    const listed = Math.max(...nonces);
    const lowest = Math.max(listed + 1, newestNonce - NEWEST_CHECKED + 1);
    for (let top = newestNonce; top >= lowest; top -= 100) {
      const names: string[] = [];
      for (let nonce = top; nonce > top - 100 && nonce >= lowest; nonce--)
        names.push(`${collection}-${hexOf(nonce)}`);
      const held = await api<{ nonce: number }[]>(
        `/accounts/${address}/nfts?identifiers=${names.join(',')}&size=100&fields=nonce`
      );
      held.forEach((nft) => nonces.add(nft.nonce));
    }
  }
  return [...nonces].sort((a, b) => a - b);
};

/**
 * Who holds a key now, or null if it was burned (the API answers 404 for a
 * burned NFT). Any other failure is thrown, never read as "burned".
 */
export const keyHolder = async (
  collection: string,
  nonce: number
): Promise<string | null> => {
  const hex = nonce.toString(16);
  const padded = hex.length % 2 ? `0${hex}` : hex;
  try {
    const nft = await api<{ owner?: string }>(`/nfts/${collection}-${padded}`);
    return nft.owner ?? null;
  } catch (failure: any) {
    if (failure?.status === 404) return null;
    throw failure;
  }
};

/** Why a token cannot be paid to a wallet now. */
export type PayoutBlock = 'frozen' | 'paused';

/** Bit 0 of the first of an account's two ESDT property bytes (MetadataFrozen). */
const frozenIn = (properties: unknown): boolean => {
  if (typeof properties !== 'string' || !/^([0-9a-f]{4})?$/i.test(properties))
    throw new Error(`unexpected token properties: ${String(properties)}`);
  return properties !== '' && (parseInt(properties.slice(0, 2), 16) & 1) === 1;
};

/**
 * Whether the network would refuse to pay `token` to `wallet` now. A claim from
 * another shard than the contract's is booked first and refused at the wallet,
 * so its simulation passes and the payout and keys go back to the contract
 * (fifth audit, RT-1). Read fresh, right before signing. Any failed read is
 * thrown: it never means "fine".
 */
export const payoutBlock = async (
  wallet: string,
  token: string
): Promise<PayoutBlock | null> => {
  if (token === EGLD) return null;
  const [balance, info] = await Promise.all([
    freshGateway(`/address/${wallet}/esdt/${token}`),
    fresh(`/tokens/${token}`)
  ]);
  if (!balance.ok || !info.ok)
    throw new Error(`could not read ${token} for this wallet`);
  const [{ code, data }, { isPaused }] = await Promise.all([
    balance.json(),
    info.json()
  ]);
  if (code !== 'successful' || typeof isPaused !== 'boolean')
    throw new Error(`could not read ${token} for this wallet`);
  if (frozenIn(data?.tokenData?.properties)) return 'frozen';
  return isPaused ? 'paused' : null;
};

export interface HistoryEvent {
  kind: 'created' | 'claimed' | 'cancelled';
  txHash: string;
  timestamp: number;
  /** The caller: creator, claimer or canceller. */
  address: string;
  /** Claimed or refunded (for created: the total). */
  amount: bigint;
  /**
   * The contract booked it and the wallet refused what it paid, so it went
   * back to the contract. null: this could not be read.
   */
  refused: boolean | null;
}

const NAMES: Record<string, HistoryEvent['kind']> = {
  [Buffer.from('vestingCreated').toString('hex')]: 'created',
  [Buffer.from('vestingClaimed').toString('hex')]: 'claimed',
  [Buffer.from('vestingCancelled').toString('hex')]: 'cancelled'
};

/** The first nested BigUint in an event's data (amount, refund or total). */
const firstAmount = (dataHex: string): bigint => {
  const length = parseInt(dataHex.slice(0, 8), 16);
  if (!Number.isFinite(length) || length === 0) return 0n;
  return BigInt(`0x${dataHex.slice(8, 8 + length * 2)}`);
};

const toBech32 = (hex: string) => Address.newFromHex(hex).toBech32();

/** The endpoints that log a vesting's events, as the API names them. */
const HISTORY_ENDPOINTS = ['create', 'createBatch', 'claim', 'cancel'];

/**
 * The created, claimed and cancelled events of vesting `id`, oldest first. The
 * API filters by one topic, which matches it in any position: a small id also
 * matches every key moved one at a time (quantity 01). Asking per endpoint
 * leaves those out (they are logged as ESDT transfers), and each list is read
 * to its end.
 */
export const historyOf = async (id: number): Promise<HistoryEvent[]> => {
  const lists = await Promise.all(
    HISTORY_ENDPOINTS.map(async (endpoint) => {
      const found: any[] = [];
      for (let from = 0; from < API_WINDOW; from += 100) {
        const events =
          (await api<any[]>(
            `/events?address=${contractAddress}&identifier=${endpoint}&topics=${hexOf(id)}&from=${from}&size=100`
          )) ?? [];
        found.push(...events.filter((event) => event.identifier === endpoint));
        if (events.length < 100) break;
      }
      return found;
    })
  );
  const history: HistoryEvent[] = [];
  const seen = new Set<string>();
  for (const event of lists.flat()) {
    const topics: string[] = event.topics ?? [];
    const kind = NAMES[topics[0]];
    if (!kind || topics[1] !== hexOf(id)) continue;
    const txHash = String(event.txHash ?? '').split('-')[0];
    if (seen.has(`${kind}:${event.txHash}`)) continue;
    seen.add(`${kind}:${event.txHash}`);
    const data = Array.isArray(event.data) ? event.data[0] : event.data;
    history.push({
      kind,
      txHash,
      timestamp: Number(event.timestamp ?? 0),
      address: toBech32(topics[2]),
      amount: data ? firstAmount(String(data)) : 0n,
      refused: false
    });
  }
  // The logs say what was booked; only the transaction's status says whether
  // what it paid arrived (fifth audit, RT-1).
  const paying = history.filter((event) => event.kind !== 'created');
  const refused = await refusedAmong(paying.map((event) => event.txHash));
  for (const event of paying)
    event.refused = refused ? refused.has(event.txHash) : null;
  return history.sort((a, b) => a.timestamp - b.timestamp);
};

/** Which of `hashes` failed, or null when that could not be read. */
const refusedAmong = async (hashes: string[]): Promise<Set<string> | null> => {
  const unique = [...new Set(hashes)];
  const failed = new Set<string>();
  try {
    for (let from = 0; from < unique.length; from += 50) {
      const part = unique.slice(from, from + 50);
      const list = await api<{ txHash: string; status: string }[]>(
        `/transactions?hashes=${part.join(',')}&fields=txHash,status&size=${part.length}`
      );
      for (const { txHash, status } of list)
        if (status === 'fail') failed.add(txHash);
    }
  } catch {
    return null;
  }
  return failed;
};

export interface TxOutcome {
  /**
   * 'missing': the network has not seen it for long enough to say it never
   * went through (set by whoever follows it; outcomeOf only flags `unknown`).
   */
  status: 'success' | 'fail' | 'invalid' | 'pending' | 'missing';
  /** Pending, and the API does not know the hash at all (yet). */
  unknown?: boolean;
  /** The contract's or the protocol's reason, when it failed. */
  reason?: string;
  /**
   * It failed, yet the contract booked this: a transfer it then made was
   * refused at the other end and came back. The API calls such a transaction
   * `fail`, but it did not "not happen" (fifth audit, RT-1).
   */
  bounced?: BookedKind;
}

/** What the contract's own events say a transaction did. */
export type BookedKind = 'created' | 'claimed' | 'cancelled';

const BOOKED: Record<string, BookedKind> = {
  vestingCreated: 'created',
  vestingClaimed: 'claimed',
  vestingCancelled: 'cancelled'
};

const eventsOf = (tx: any): any[] => [
  ...(tx.logs?.events ?? []),
  ...(tx.results ?? []).flatMap((result: any) => result.logs?.events ?? [])
];

const topicName = (event: any) => {
  try {
    return atob(event.topics?.[0] ?? '');
  } catch {
    return '';
  }
};

/** What the contract booked in a transaction that failed, if anything. */
const bookedIn = (tx: any): BookedKind | undefined => {
  for (const event of eventsOf(tx)) {
    if (event.address !== contractAddress) continue;
    const kind = BOOKED[topicName(event)];
    if (kind) return kind;
  }
  return undefined;
};

/** Where a sent transaction stands, read fresh (not cached). */
export const outcomeOf = async (hash: string): Promise<TxOutcome> => {
  const response = await fresh(
    `/transactions/${hash}?withResults=true&withLogs=true`
  );
  if (!response.ok)
    return { status: 'pending', unknown: response.status === 404 };
  const tx = await response.json();
  if (tx.status === 'pending' || tx.pendingResults)
    return { status: 'pending' };
  if (tx.status === 'success') return { status: 'success' };
  const signal = eventsOf(tx).find(
    (event: any) => event.identifier === 'signalError'
  );
  const reason =
    (signal?.topics?.[1] && atob(signal.topics[1])) ||
    (tx.results ?? [])
      .map((result: any) => result.returnMessage)
      .find(Boolean) ||
    tx.status;
  if (tx.status === 'invalid') return { status: 'invalid', reason };
  const bounced = bookedIn(tx);
  return { status: 'fail', reason, ...(bounced ? { bounced } : {}) };
};

/** A claim or cancel of this wallet that the contract booked and the wallet refused. */
export interface RefusedPayout {
  txHash: string;
  timestamp: number;
  kind: 'claimed' | 'cancelled';
  /** The vestings it was for. */
  ids: number[];
}

const idFrom = (raw: string) => {
  let value = 0;
  for (const char of raw) value = value * 256 + char.charCodeAt(0);
  return value;
};

/**
 * The newest refused payouts of `wallet`: the key has left its wallet or was
 * burned and the money never came, so nothing in My vestings shows them, and
 * only this read still can. Only the wallet's own failed transactions are read,
 * which nobody else can add to.
 */
export const refusedPayouts = async (
  wallet: string
): Promise<RefusedPayout[]> => {
  const list = await api<any[]>(
    `/accounts/${wallet}/transactions?function=claim,cancel&status=fail&size=25&withScResults=true&withLogs=true`
  );
  const refused: RefusedPayout[] = [];
  for (const tx of list) {
    const kind = bookedIn(tx);
    if (kind !== 'claimed' && kind !== 'cancelled') continue;
    const ids = new Set<number>();
    for (const event of eventsOf(tx)) {
      if (event.address !== contractAddress || !BOOKED[topicName(event)])
        continue;
      ids.add(idFrom(atob(event.topics?.[1] ?? '')));
    }
    refused.push({
      txHash: tx.txHash,
      timestamp: Number(tx.timestamp ?? 0),
      kind,
      ids: [...ids].sort((a, b) => a - b)
    });
  }
  return refused;
};

/** What finished claims and cancels paid their caller, for one token. */
export interface Payout {
  token: string;
  /** Paid by claims. */
  claimed: bigint;
  /** Paid back by cancels: the part not vested at the cancel. */
  refunded: bigint;
  /**
   * Vested at a cancel: the beneficiary's, claimed or not (CancelledEvent.vested
   * counts what was claimed before the cancel too). What is still claimable
   * needs the vesting's own read (`cancelledIds`).
   */
  vestedAtCancel: bigint;
  /** The vestings these transactions cancelled. */
  cancelledIds: number[];
}

const bytesOf = (base64: string) =>
  Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));

/** The nested BigUints of an event's data, in order (4-byte length, then bytes). */
const nestedAmounts = (data: Uint8Array): bigint[] => {
  const amounts: bigint[] = [];
  let at = 0;
  while (at + 4 <= data.length) {
    const length =
      ((data[at] << 24) |
        (data[at + 1] << 16) |
        (data[at + 2] << 8) |
        data[at + 3]) >>>
      0;
    at += 4;
    if (at + length > data.length) break;
    let value = 0n;
    for (const byte of data.slice(at, at + length))
      value = (value << 8n) | BigInt(byte);
    amounts.push(value);
    at += length;
  }
  return amounts;
};

/**
 * What a set of finished transactions paid out, per token, from mvxvest's own
 * vestingClaimed and vestingCancelled events. Only events logged by the
 * contract count, each vesting once per transaction, and with `caller` only
 * those whose caller topic is that address (the one that was paid).
 */
export const payoutsOf = async (
  hashes: string[],
  caller?: string
): Promise<Payout[]> => {
  const callerKey = caller
    ? String.fromCharCode(...Address.newFromBech32(caller).getPublicKey())
    : undefined;
  const byToken = new Map<string, Payout>();
  const seen = new Set<string>();
  for (const hash of hashes) {
    const response = await fresh(
      `/transactions/${hash}?withLogs=true&withResults=true`
    );
    if (!response.ok) throw new Error(`transaction ${hash} not readable`);
    const tx = await response.json();
    // Booked and then refused at the wallet: nothing was paid (fifth audit,
    // RT-1). The events alone read like a claim that paid.
    if (tx.status === 'fail' || tx.status === 'invalid') continue;
    for (const event of eventsOf(tx)) {
      if (event.address !== contractAddress) continue;
      const [name, id, paid, token] = (event.topics ?? []).map(
        (topic: string) => atob(topic)
      );
      if (name !== 'vestingClaimed' && name !== 'vestingCancelled') continue;
      if (id === undefined || !token || typeof event.data !== 'string')
        continue;
      if (callerKey !== undefined && paid !== callerKey) continue;
      const key = `${hash}:${name}:${id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const [first = 0n, second = 0n] = nestedAmounts(bytesOf(event.data));
      const payout: Payout = byToken.get(token) ?? {
        token,
        claimed: 0n,
        refunded: 0n,
        vestedAtCancel: 0n,
        cancelledIds: []
      };
      if (name === 'vestingClaimed') payout.claimed += first;
      else {
        payout.refunded += first;
        payout.vestedAtCancel += second;
        payout.cancelledIds.push(idFrom(id));
      }
      byToken.set(token, payout);
    }
  }
  return [...byToken.values()];
};

/** Ids of the vestings a transaction created, from its vestingCreated events. */
export const createdIdsOf = async (hash: string): Promise<number[]> => {
  const response = await fresh(
    `/transactions/${hash}?withLogs=true&withResults=true`
  );
  if (!response.ok) return [];
  const tx = await response.json();
  const events = [
    ...(tx.logs?.events ?? []),
    ...(tx.results ?? []).flatMap((result: any) => result.logs?.events ?? [])
  ];
  const ids = new Set<number>();
  for (const event of events) {
    const [name, id] = (event.topics ?? []).map((topic: string) => atob(topic));
    if (name !== 'vestingCreated' || id === undefined) continue;
    let value = 0;
    for (const char of id) value = value * 256 + char.charCodeAt(0);
    ids.add(value);
  }
  return [...ids].sort((a, b) => a - b);
};
