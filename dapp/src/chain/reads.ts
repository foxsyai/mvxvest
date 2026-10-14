// Reads from the public API: what a wallet holds (keys, tokens, EGLD), what a
// token is, and the history of a vesting from the contract's events. Nothing
// here signs or sends.

import { Address } from '@multiversx/sdk-core';
import { contractAddress } from 'config';
import { EGLD } from 'vesting/client';
import { api, fresh } from './network';

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

export interface HistoryEvent {
  kind: 'created' | 'claimed' | 'cancelled';
  txHash: string;
  timestamp: number;
  /** The caller: creator, claimer or canceller. */
  address: string;
  /** Claimed or refunded (for created: the total). */
  amount: bigint;
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
      amount: data ? firstAmount(String(data)) : 0n
    });
  }
  return history.sort((a, b) => a.timestamp - b.timestamp);
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
}

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
  const events = [
    ...(tx.logs?.events ?? []),
    ...(tx.results ?? []).flatMap((result: any) => result.logs?.events ?? [])
  ];
  const signal = events.find(
    (event: any) => event.identifier === 'signalError'
  );
  const reason =
    (signal?.topics?.[1] && atob(signal.topics[1])) ||
    (tx.results ?? [])
      .map((result: any) => result.returnMessage)
      .find(Boolean) ||
    tx.status;
  return { status: tx.status === 'invalid' ? 'invalid' : 'fail', reason };
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
    const events = [
      ...(tx.logs?.events ?? []),
      ...(tx.results ?? []).flatMap((result: any) => result.logs?.events ?? [])
    ];
    for (const event of events) {
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
        let value = 0;
        for (const char of id) value = value * 256 + char.charCodeAt(0);
        payout.cancelledIds.push(value);
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
