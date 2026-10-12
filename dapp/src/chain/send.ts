// Sending transactions the wallet signs. Two steps, so the page can show what
// will happen before anything is signed:
//
// 1. prepare(): the nonce from the network (a stale one made transactions
//    vanish on mvxsafe), the guardian of a guarded account, and a gas limit
//    from the network's own simulation. A transaction the contract would refuse
//    fails here, with the contract's reason, before the wallet is opened.
// 2. send(): one wallet prompt for all of them, sent in nonce order, tracked.
//
// Gas: the simulation's figure times 1.2, at most 600M. A limit far above what
// is used is charged in full ("too much gas provided"), as devnet showed.

import {
  Address,
  Transaction,
  TransactionComputer
} from '@multiversx/sdk-core';
import { setAccountNonce } from '@multiversx/sdk-dapp/out/store/actions/account/accountActions';
import { getAccountProvider, TransactionManager } from 'lib';
import { api, forget, networkProvider } from './network';

export const MAX_GAS = 600_000_000n;
const GUARDED_EXTRA_GAS = 50_000n;

export interface Prepared {
  transactions: Transaction[];
  /** Per transaction: null when the simulation passed, else why it would fail. */
  problems: (string | null)[];
}

const guardianOf = async (address: string): Promise<string> => {
  try {
    const account = await api<{
      isGuarded?: boolean;
      activeGuardianAddress?: string;
    }>(`/accounts/${address}?withGuardianInfo=true`);
    return account?.isGuarded ? (account.activeGuardianAddress ?? '') : '';
  } catch {
    return '';
  }
};

/** The contract's words from a failed simulation, without the transport noise. */
const simulationReason = (failure: unknown) => {
  const message = String(
    (failure as any)?.message ?? failure ?? 'the simulation failed'
  );
  const match = /(?:user error|execution failed)[:\s]*(.*)$/i.exec(message);
  return (match?.[1] || message).replace(/^["\s]+|["\s]+$/g, '').slice(0, 300);
};

/**
 * Nonces, guardian and gas for `transactions`, each checked by the network's
 * simulation. `firstNonce` overrides the account's nonce when transactions of
 * this sender are still pending (a resend of the rest of a batch).
 */
export const prepare = async (
  sender: string,
  transactions: Transaction[],
  firstNonce?: bigint
): Promise<Prepared> => {
  const account = await networkProvider.getAccount(
    Address.newFromBech32(sender)
  );
  const accountNonce = BigInt(account.nonce);
  const startNonce =
    firstNonce !== undefined && firstNonce > accountNonce
      ? firstNonce
      : accountNonce;
  const guardian = await guardianOf(sender);
  // The guardian's extra gas must fit too: the network refuses any limit
  // above 600M.
  const cap = guardian ? MAX_GAS - GUARDED_EXTRA_GAS : MAX_GAS;
  const computer = new TransactionComputer();
  const problems: (string | null)[] = [];

  for (const [index, transaction] of transactions.entries()) {
    // Simulated one by one with the account's nonce: each transaction of a
    // batch stands on its own.
    transaction.nonce = accountNonce;
    transaction.gasLimit = MAX_GAS;
    try {
      const cost = BigInt(
        (await networkProvider.estimateTransactionCost(transaction)).gasLimit
      );
      if (cost > cap) {
        transaction.gasLimit = cap;
        problems.push(
          `it needs ${cost.toLocaleString('en-US')} gas, more than one transaction may carry: send fewer vestings at once`
        );
      } else {
        const fitted = (cost * 12n) / 10n;
        transaction.gasLimit = fitted > cap ? cap : fitted;
        problems.push(null);
      }
    } catch (failure) {
      problems.push(simulationReason(failure));
    }
    transaction.nonce = startNonce + BigInt(index);
    if (guardian) {
      computer.applyGuardian(transaction, Address.newFromBech32(guardian));
      transaction.gasLimit += GUARDED_EXTRA_GAS;
    }
  }
  return { transactions, problems };
};

export interface Sent {
  /** Hashes of the transactions the network accepted, in order. */
  hashes: string[];
  /**
   * When not every transaction was sent: the index of the first one that was
   * not (it and every later one did not reach the network), and why.
   */
  stopped?: { at: number; reason: string };
  /** The nonce the next transaction of this sender should use. */
  nextNonce: bigint;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const reasonOf = (failure: unknown) =>
  String(
    (failure as any)?.response?.data?.message ??
      (failure as any)?.message ??
      failure ??
      'unknown error'
  ).slice(0, 200);

const retryable = (failure: unknown) =>
  /\b(429|500|502|503|504)\b|too many|timeout|timed out|network|failed to fetch/i.test(
    `${(failure as any)?.response?.status ?? ''} ${reasonOf(failure)}`
  );

/**
 * Sends one signed transaction, asking again on a refusal that may pass later
 * (rate limit, server error). A transaction the network already holds is
 * accepted as sent: the signed bytes, and so the hash, are the same.
 */
const sendOne = async (manager: any, transaction: Transaction) => {
  for (let attempt = 0; ; attempt++) {
    try {
      const sent = await manager.send([transaction]);
      return Array.isArray(sent) ? sent.flat() : [sent];
    } catch (failure) {
      if (/already|duplicat/i.test(reasonOf(failure))) {
        const hash = Buffer.from(
          new TransactionComputer().computeTransactionHash(transaction)
        ).toString('hex');
        return [{ ...transaction.toPlainObject(), hash, status: 'pending' }];
      }
      if (attempt >= 3 || !retryable(failure)) throw failure;
      // The API counts requests per second: 0.4, 0.8 then 1.6 s is enough.
      await wait(400 * 2 ** attempt);
    }
  }
};

/**
 * One wallet prompt for every transaction, then sent one at a time in nonce
 * order and tracked. Rejects when the wallet refuses or when not even the first
 * transaction reached the network; when some did, it resolves with their
 * hashes and says where it stopped, so nothing sent is ever reported as lost
 * (and nothing is offered twice).
 */
export const send = async (
  transactions: Transaction[],
  label: string
): Promise<Sent> => {
  const provider = getAccountProvider();
  const manager = TransactionManager.getInstance();
  const signed = await provider.signTransactions(transactions);
  const sent: any[] = [];
  let stopped: Sent['stopped'];
  for (const [index, transaction] of signed.entries()) {
    try {
      sent.push(...(await sendOne(manager, transaction)));
    } catch (failure) {
      // sdk-dapp moved its stored nonce forward when the wallet signed; the
      // ones not sent did not use theirs (mvxsafe tx audit TX-08).
      setAccountNonce(Number(transactions[index].nonce));
      if (sent.length === 0) throw failure;
      stopped = { at: index, reason: reasonOf(failure) };
      break;
    }
  }
  const hashes: string[] = sent
    .map((transaction: any) => transaction?.hash ?? '')
    .filter(Boolean);
  const touched = new Set<string>();
  for (const transaction of transactions) {
    touched.add(transaction.sender.toBech32());
    touched.add(transaction.receiver.toBech32());
  }
  const settled = () => {
    for (const address of touched) forget(address);
    window.dispatchEvent(
      new CustomEvent('mvxvest:settled', {
        detail: { addresses: [...touched] }
      })
    );
  };
  try {
    await manager.track(sent, {
      transactionsDisplayInfo: {
        processingMessage: `${label}...`,
        errorMessage: `${label} failed`,
        successMessage: `${label} done`
      },
      onSuccess: async () => settled(),
      onFail: async () => settled()
    });
  } catch {
    // Tracking only drives the toasts; the page follows each hash itself.
  }
  // And on a clock, which does not depend on the SDK's socket: a block takes
  // about six seconds, a cross-shard result a little longer.
  setTimeout(settled, 8_000);
  setTimeout(settled, 18_000);
  const lastSent = transactions[(stopped?.at ?? transactions.length) - 1];
  return { hashes, stopped, nextNonce: (lastSent?.nonce ?? 0n) + 1n };
};
