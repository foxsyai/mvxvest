// The vestings an address can act on: those whose claim key it holds, and
// those it created (with the cancel keys it still holds).

import type { Vesting } from 'vesting/client';
import { keysHeld } from './reads';
import { vesting } from './vesting';

const chunks = <T>(items: T[], size: number) =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, i) =>
    items.slice(i * size, i * size + size)
  );

/**
 * Vestings whose claim key `address` holds. Each vesting mints exactly one
 * claim key, in order, so a key's nonce is its vesting's id: all are read in
 * one call per 100 and checked; any key that does not match is looked up on
 * its own.
 */
export const claimableVestings = async (
  address: string,
  claimCollection: string
): Promise<Vesting[]> => {
  const nonces = await keysHeld(address, claimCollection);
  const found: Vesting[] = [];
  const count = await vesting.vestingCount();
  const guessed = nonces.filter((nonce) => nonce <= count);
  for (const part of chunks(guessed, 100)) {
    const list = await vesting.vestings(part);
    for (const [index, item] of list.entries()) {
      if (item.claimNonce === part[index]) found.push(item);
      else {
        const id = await vesting.vestingByClaimNonce(part[index]);
        if (id) found.push(await vesting.vesting(id));
      }
    }
  }
  return found.sort((a, b) => b.id - a.id);
};

/**
 * Vestings `address` created, newest first: the newest `limit` of `count`.
 */
export const createdVestings = async (
  address: string,
  limit = 500
): Promise<{ list: Vesting[]; count: number }> => {
  const count = await vesting.countByCreator(address);
  const ids: number[] = [];
  // The newest `limit`: the index is oldest first.
  for (let from = Math.max(0, count - limit); from < count; from += 100) {
    ids.push(...(await vesting.idsByCreator(address, from, 100)));
  }
  const list: Vesting[] = [];
  for (const part of chunks(ids, 100))
    list.push(...(await vesting.vestings(part)));
  return { list: list.sort((a, b) => b.id - a.id), count };
};

/**
 * Vestings whose cancel key `address` holds although it did not create them
 * (a key sent on to a treasury, a multisig, a new owner), newest first: each
 * cancel key held that is not one of `known` is looked up by its nonce.
 */
export const cancelKeysOfOthers = async (
  address: string,
  cancelCollection: string,
  known: Vesting[],
  limit = 100
): Promise<Vesting[]> => {
  const mine = new Set(known.map((v) => v.cancelNonce));
  const others = (await keysHeld(address, cancelCollection))
    .filter((nonce) => !mine.has(nonce))
    .slice(-limit);
  const ids: number[] = [];
  for (const nonce of others) {
    const id = await vesting.vestingByCancelNonce(nonce);
    if (id) ids.push(id);
  }
  const list: Vesting[] = [];
  for (const part of chunks(ids, 100))
    list.push(...(await vesting.vestings(part)));
  return list.sort((a, b) => b.id - a.id);
};

/** Every vesting of a token (at most `limit`), newest first. */
export const tokenVestings = async (
  token: string,
  limit = 2_000
): Promise<{ list: Vesting[]; count: number }> => {
  const count = await vesting.countByToken(token);
  const ids: number[] = [];
  for (let from = Math.max(0, count - limit); from < count; from += 100) {
    ids.push(...(await vesting.idsByToken(token, from, 100)));
  }
  const list: Vesting[] = [];
  for (const part of chunks(ids, 100))
    list.push(...(await vesting.vestings(part)));
  return { list: list.sort((a, b) => b.id - a.id), count };
};
