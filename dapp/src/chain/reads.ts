// Reads from the public API: what a wallet holds (keys, tokens, EGLD), what a
// token is, and the history of a vesting from the contract's events. Nothing
// here signs or sends.

import { Address } from '@multiversx/sdk-core';
import { contractAddress } from 'config';
import { EGLD } from 'vesting/client';
import { api, apiUrl } from './network';

export interface TokenInfo {
  identifier: string;
  ticker: string;
  name: string;
  decimals: number;
  /** Logo, when the token has registered assets. */
  icon?: string;
}

/** "TFOX" from "TFOX-d61b09": the API's ticker is the full id when a token has no assets. */
const tickerOf = (ticker: string | undefined, identifier: string) =>
  (ticker || identifier).split('-')[0];

export const EGLD_INFO: TokenInfo = {
  identifier: EGLD,
  ticker: 'EGLD',
  name: 'EGLD',
  decimals: 18
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
    icon: token.assets?.svgUrl ?? token.assets?.pngUrl
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

/** Nonces of the keys of `collection` that `address` holds. */
export const keysHeld = async (
  address: string,
  collection: string
): Promise<number[]> => {
  if (!collection) return [];
  const nonces: number[] = [];
  for (let from = 0; ; from += 100) {
    const page = await api<{ nonce: number }[]>(
      `/accounts/${address}/nfts?collections=${collection}&from=${from}&size=100&fields=nonce`
    );
    nonces.push(...page.map((nft) => nft.nonce));
    if (page.length < 100) break;
  }
  return nonces.sort((a, b) => a - b);
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

const hexOf = (n: number) => {
  const hex = n.toString(16);
  return hex.length % 2 ? `0${hex}` : hex;
};
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
/** How far the API pages (its search window). */
const API_WINDOW = 10_000;

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
  // A stalled connection must not stop the following for good.
  const response = await fetch(
    `${apiUrl}/transactions/${hash}?withResults=true&withLogs=true`,
    { signal: AbortSignal.timeout(15_000) }
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

/** Ids of the vestings a transaction created, from its vestingCreated events. */
export const createdIdsOf = async (hash: string): Promise<number[]> => {
  const response = await fetch(
    `${apiUrl}/transactions/${hash}?withLogs=true&withResults=true`
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
