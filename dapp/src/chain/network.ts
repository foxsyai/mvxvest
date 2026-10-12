// Everything this app knows about the chain (from mvxsafe.io, same author). There is no backend: the browser
// reads the public MultiversX API directly, so two rules shape this file.
//
// 1. The API allows about two requests per second per IP, and that IP is the
//    visitor's own. A vesting page needs a dozen reads, so requests go through a
//    small queue with a cache rather than firing at once.
// 2. Reads are cheap but not free. Anything already fetched in the last minute
//    is reused, which makes moving between pages feel instant.

import { ApiNetworkProvider } from '@multiversx/sdk-core';
import { environment } from 'config';

const API_BY_NETWORK: Record<string, string> = {
  mainnet: 'https://api.multiversx.com',
  devnet: 'https://devnet-api.multiversx.com',
  testnet: 'https://testnet-api.multiversx.com'
};

const CHAIN_ID_BY_NETWORK: Record<string, string> = {
  mainnet: '1',
  devnet: 'D',
  testnet: 'T'
};

export const networkName = String(environment);
export const apiUrl = API_BY_NETWORK[networkName] ?? API_BY_NETWORK.mainnet;
export const chainId = CHAIN_ID_BY_NETWORK[networkName] ?? '1';
export const explorerUrl =
  networkName === 'mainnet'
    ? 'https://explorer.multiversx.com'
    : `https://${networkName}-explorer.multiversx.com`;

export const networkProvider = new ApiNetworkProvider(apiUrl, {
  clientName: 'mvxvest.io',
  timeout: 15000
});

// --- the queue, the pacing and the cache -------------------------------------
//
// The public API allows about two requests a second from one visitor and
// answers 429 beyond that. Firing a burst and ignoring the refusals left cards
// stuck on "..." and the browser retrying nothing. So: a token bucket paces the
// calls, refusals are retried with a growing wait, and answers are remembered.

// Two minutes: a transaction sent from this app forgets its own safe at once
// (forget), so the cache only delays what other signers do elsewhere, and
// Refresh reads everything again.
const CACHE_MS = 120_000;
// The documentation asks for two requests a second per visitor. Short bursts
// are tolerated (20 calls in 0.3 s, measured), so a page may start with a
// burst of eight; after that the pace is four a second, three at a time. At
// eight a second, sustained use during the mainnet test of 7 Oct 2026 tripped
// the API's rate limit (Cloudflare 1015) again and again.
const RATE_PER_SECOND = 4;
const BURST = 8;
const MAX_IN_FLIGHT = 3;
const MAX_ATTEMPTS = 4;

interface CacheEntry {
  at: number;
  value: unknown;
}

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<unknown>>();
const queue: (() => void)[] = [];
let running = 0;
let tokens = BURST;
let lastRefill = Date.now();

const refill = () => {
  const now = Date.now();
  tokens = Math.min(
    BURST,
    tokens + ((now - lastRefill) / 1000) * RATE_PER_SECOND
  );
  lastRefill = now;
};

// One timer at most, and only to wait for the pace or a pause: waiting for a
// free slot needs none, since every finishing request pumps again. Polling
// every 250 ms while requests were stuck was wasted work.
let pumpTimer: ReturnType<typeof setTimeout> | undefined;
const pumpIn = (ms: number) => {
  if (pumpTimer) return;
  pumpTimer = setTimeout(
    () => {
      pumpTimer = undefined;
      pump();
    },
    Math.max(0, ms)
  );
};

const pump = () => {
  const wait = pausedUntil - Date.now();
  if (wait > 0) {
    pumpIn(wait);
    return;
  }
  refill();
  while (queue.length > 0 && running < MAX_IN_FLIGHT && tokens >= 1) {
    tokens -= 1;
    running++;
    (queue.shift() as () => void)();
  }
  if (queue.length > 0 && running < MAX_IN_FLIGHT) {
    pumpIn(Math.ceil(((1 - tokens) / RATE_PER_SECOND) * 1000));
  }
};

const schedule = <T>(work: () => Promise<T>): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    queue.push(() => {
      work()
        .then(resolve)
        .catch(reject)
        .finally(() => {
          running--;
          pump();
        });
    });
    pump();
  });

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const RETRY_STATUS = new Set([429, 500, 502, 503, 504]);

/** A failed API read that knows whether asking again could help. */
class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number | undefined,
    readonly retryable: boolean
  ) {
    super(message);
  }
}

/**
 * True for the answers that mean "ask again later" rather than "no". An API
 * read decides on its HTTP status: the old text search also matched "502"
 * inside an address in the request path, and missed Chrome's "Failed to
 * fetch" (web audit WEB-10, 7 Oct 2026). Contract queries come back from the
 * SDK as text, so for those the numbers are matched as whole words only.
 */
const worthRetrying = (error: any) => {
  if (error instanceof ApiError) return error.retryable;
  const text = String(error?.message ?? error ?? '');
  return /\b(429|502|503|504)\b|Too Many Requests|timeout|timed out|Network|Failed to fetch/i.test(
    text
  );
};

/**
 * A refusal, a timeout or a dropped connection, as opposed to an answer from
 * the contract itself. Anything that is not clearly the contract saying no is
 * treated as temporary: a slow API used to make a safe read as "not a
 * multisig" (7 Oct 2026, when one answer took 18 seconds).
 */
export const isTransient = (error: unknown) =>
  !/function not found|invalid function|execution failed|user error|wrong number of arguments/i.test(
    String((error as any)?.message ?? error ?? '')
  );

const isRateLimit = (error: any) =>
  (error instanceof ApiError && error.status === 429) ||
  /\b429\b|Too Many Requests|1015/i.test(String(error?.message ?? error ?? ''));

// When the API says "too many", the whole queue waits, instead of every
// request retrying on its own and keeping the limit tripped (7 Oct 2026).
let pausedUntil = 0;

const REQUEST_TIMEOUT_MS = 15_000;

/**
 * fetch, but settled within REQUEST_TIMEOUT_MS whatever the connection does. A
 * stalled connection used to hold one of the six request slots for ever, and
 * six of them stopped every read in the app until a reload (WEB-06). The race
 * settles even when the request ignores the abort.
 */
const fetchWithTimeout = (url: string): Promise<Response> => {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(
        new ApiError(
          `${url} timed out after ${REQUEST_TIMEOUT_MS / 1000} s`,
          undefined,
          true
        )
      );
    }, REQUEST_TIMEOUT_MS);
  });
  return Promise.race([
    fetch(url, { signal: controller.signal }),
    timeout
  ]).finally(() => clearTimeout(timer));
};

// Bumped by clearCache and forget: an answer that was asked for before a
// Refresh, or before a transaction landed, must not be written over what was
// read after it (WEB-11).
let generation = 0;
let clearedIn = 0;
const forgottenIn = new Map<string, number>();

/**
 * Runs `work` behind the queue and remembers its answer for a minute. Two
 * components asking for the same thing share one request rather than making two.
 */
export const cached = async <T>(
  key: string,
  work: () => Promise<T>
): Promise<T> => {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value as T;

  const already = inflight.get(key);
  if (already) return already as Promise<T>;

  const startedIn = generation;
  const attempt = async (): Promise<T> => {
    let lastError: unknown;
    for (let round = 0; round < MAX_ATTEMPTS; round++) {
      try {
        const value = await schedule(work);
        if (
          startedIn >= clearedIn &&
          (forgottenIn.get(key) ?? -1) <= startedIn
        ) {
          cache.set(key, { at: Date.now(), value });
        }
        return value;
      } catch (error) {
        lastError = error;
        if (!worthRetrying(error)) break;
        if (isRateLimit(error)) {
          pausedUntil = Math.max(
            pausedUntil,
            Date.now() + 2000 * Math.pow(2, round)
          );
        }
        await wait(600 * Math.pow(2, round));
      }
    }
    throw lastError;
  };

  const promise: Promise<T> = attempt().finally(() => {
    // Only its own entry: a read started after a Refresh may hold the key now.
    if (inflight.get(key) === promise) inflight.delete(key);
  });
  inflight.set(key, promise);
  return promise;
};

/** Drops everything cached, so a Refresh button really refetches. */
export const clearCache = () => {
  generation++;
  clearedIn = generation;
  cache.clear();
  inflight.clear();
};

// A signing panel saw its transactions' final result: what was read before
// may be out of date anywhere on the page. Once per signing, so clearing
// everything costs a few reads, not the cost mvxsafe met per transaction.
if (typeof window !== 'undefined')
  window.addEventListener('mvxvest:final', () => clearCache());

/**
 * Drops what is cached about one address only. After a transaction to one
 * safe, that safe is read again and every other one stays as fast as it was:
 * wiping everything after each transaction made a list of eight safes re-read
 * all of them several times in a row (7 Oct 2026).
 */
export const forget = (address: string) => {
  generation++;
  for (const key of [...cache.keys(), ...inflight.keys()]) {
    if (!key.includes(address)) continue;
    cache.delete(key);
    inflight.delete(key);
    forgottenIn.set(key, generation);
  }
};

/**
 * A GET on the public API, queued, retried and cached for a minute by path.
 * NEVER call it inside cached(): both queue, so the outer call holds one of
 * the six slots while waiting for another, and six of those at once stop
 * every read in the app (a list of eight safes froze on 7 Oct 2026).
 */
export const api = async <T>(path: string): Promise<T> =>
  cached(`api:${path}`, async () => {
    let response: Response;
    try {
      response = await fetchWithTimeout(`${apiUrl}${path}`);
    } catch (failure: any) {
      if (failure instanceof ApiError) throw failure;
      // fetch rejects only when the request never got an answer: worth retrying.
      throw new ApiError(
        `${path}: ${failure?.message ?? 'network error'}`,
        undefined,
        true
      );
    }
    if (!response.ok) {
      throw new ApiError(
        `${path} answered ${response.status}`,
        response.status,
        RETRY_STATUS.has(response.status)
      );
    }
    return (await response.json()) as T;
  });
