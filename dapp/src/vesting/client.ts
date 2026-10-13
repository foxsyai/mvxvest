// The vesting contract, typed: every view the dApp reads and every transaction
// it builds. It holds no key and sends nothing: transactions are returned
// unsigned and go through chain/send.ts, which the wallet signs.
//
// The ABI is the contract's own (mvxvest.abi.json, copied from
// contracts/vesting/output by `pnpm sync-abi`; CI checks they match).

import {
  Abi,
  Address,
  INetworkProvider,
  SmartContractController,
  SmartContractTransactionsFactory,
  Token,
  TokenTransfer,
  Transaction,
  TransactionsFactoryConfig
} from '@multiversx/sdk-core';
import { DEFAULT_LIMITS, Limits } from './batches';
import { tokenFeeOf, tokenFeeOfAll } from './fees';
import abiJson from './mvxvest.abi.json';
import { Curve, Schedule } from './schedule';

export const abi = Abi.create(abiJson);

export const EGLD = 'EGLD-000000';

export interface Vesting {
  id: number;
  creator: string;
  /** Who it was made for. The claim key may have moved since. */
  beneficiary: string;
  token: string;
  total: bigint;
  schedule: Schedule;
  cancelable: boolean;
  createdAt: number;
  claimNonce: number;
  /** 0 when not cancelable. */
  cancelNonce: number;
  label: string;
  claimed: bigint;
  /** 0 unless cancelled. */
  cancelledAt: number;
  /** Vested at `timestamp`, frozen at the cancel. */
  vested: bigint;
  claimable: bigint;
  /** The most the claim key can ever collect. */
  finalAmount: bigint;
  refunded: bigint;
  /** The block time these figures were computed at. */
  timestamp: number;
}

export interface TokenTotals {
  deposited: bigint;
  claimed: bigint;
  refunded: bigint;
}

export interface NewVesting {
  beneficiary: string;
  total: bigint;
  schedule: Schedule;
}

const big = (value: any): bigint => {
  if (typeof value === 'bigint') return value;
  if (value === undefined || value === null) return 0n;
  return BigInt(
    typeof value.toFixed === 'function' ? value.toFixed() : value.toString()
  );
};
const num = (value: any): number => Number(big(value));
const text = (value: any): string =>
  value instanceof Uint8Array ||
  (typeof Buffer !== 'undefined' && Buffer.isBuffer(value))
    ? new TextDecoder().decode(value as Uint8Array)
    : String(value ?? '');
const bech32 = (value: any): string =>
  typeof value?.toBech32 === 'function' ? value.toBech32() : String(value);

const toCurve = (raw: any): Curve => {
  const name = raw?.name ?? raw;
  const fields = raw?.fields ?? {};
  if (name === 'Stepped')
    return { kind: 'stepped', interval: num(fields.interval ?? fields[0]) };
  if (name === 'Tranches') {
    const list = fields[0] ?? fields['0'] ?? [];
    return {
      kind: 'tranches',
      tranches: list.map((tranche: any) => ({
        time: num(tranche.time),
        amount: big(tranche.amount)
      }))
    };
  }
  return { kind: 'linear' };
};

const toSchedule = (raw: any): Schedule => ({
  start: num(raw.start),
  cliff: num(raw.cliff),
  cliffAmount: big(raw.cliff_amount),
  end: num(raw.end),
  curve: toCurve(raw.curve)
});

/** The contract's VestingView, as plain values. */
export const toVesting = (raw: any): Vesting => ({
  id: num(raw.id),
  creator: bech32(raw.vesting.creator),
  beneficiary: bech32(raw.vesting.beneficiary),
  token: text(raw.vesting.token),
  total: big(raw.vesting.total),
  schedule: toSchedule(raw.vesting.schedule),
  cancelable: Boolean(raw.vesting.cancelable),
  createdAt: num(raw.vesting.created_at),
  claimNonce: num(raw.vesting.claim_nonce),
  cancelNonce: num(raw.vesting.cancel_nonce),
  label: text(raw.vesting.label),
  claimed: big(raw.claimed),
  cancelledAt: num(raw.cancelled_at),
  vested: big(raw.vested),
  claimable: big(raw.claimable),
  finalAmount: big(raw.final_amount),
  refunded: big(raw.refunded),
  timestamp: num(raw.timestamp)
});

/** A schedule as the ABI's native argument. */
const scheduleArg = (schedule: Schedule) => ({
  start: schedule.start,
  cliff: schedule.cliff,
  cliff_amount: schedule.cliffAmount,
  end: schedule.end,
  curve:
    schedule.curve.kind === 'linear'
      ? { name: 'Linear', fields: {} }
      : schedule.curve.kind === 'stepped'
        ? { name: 'Stepped', fields: { interval: schedule.curve.interval } }
        : {
            name: 'Tranches',
            fields: {
              0: schedule.curve.tranches.map((t) => ({
                time: t.time,
                amount: t.amount
              }))
            }
          }
});

/** How the dApp runs a read: through the app's queue and cache, or directly. */
export type Runner = <T>(key: string, work: () => Promise<T>) => Promise<T>;

export class VestingClient {
  readonly address: Address;
  private readonly controller: SmartContractController;
  private readonly factory: SmartContractTransactionsFactory;

  constructor(
    contract: string,
    provider: INetworkProvider,
    readonly chainId: string,
    private readonly run: Runner = (_key, work) => work()
  ) {
    this.address = Address.newFromBech32(contract);
    this.controller = new SmartContractController({
      chainID: chainId,
      networkProvider: provider,
      abi
    });
    this.factory = new SmartContractTransactionsFactory({
      config: new TransactionsFactoryConfig({ chainID: chainId }),
      abi
    });
  }

  private query<T = any>(fn: string, args: any[] = []): Promise<T[]> {
    return this.run(
      `query:${this.address.toBech32()}:${fn}:${JSON.stringify(args, (_, v) => (typeof v === 'bigint' ? v.toString() : v))}`,
      () =>
        this.controller.query({
          contract: this.address,
          function: fn,
          // A copy: sdk-core packs variadic arguments by rewriting the array
          // it is given, which turned the caller's [326, 327, 328] into
          // [[326, 327, 328], 327, 328] (My vestings failed on devnet).
          arguments: [...args]
        })
    );
  }

  // ---------------------------------------------------------------- views

  async vesting(id: number): Promise<Vesting> {
    const [raw] = await this.query('getVesting', [id]);
    return toVesting(raw);
  }

  /** Several vestings in one read (at most 100). */
  async vestings(ids: number[]): Promise<Vesting[]> {
    if (ids.length === 0) return [];
    const [raw] = await this.query('getVestings', ids);
    return (raw as any[]).map(toVesting);
  }

  async vestingCount(): Promise<number> {
    const [value] = await this.query('getVestingCount');
    return num(value);
  }

  async idsByCreator(
    creator: string,
    from: number,
    count: number
  ): Promise<number[]> {
    const [raw] = await this.query('getVestingsByCreator', [
      Address.newFromBech32(creator),
      from,
      count
    ]);
    return (raw as any[]).map(num);
  }

  async countByCreator(creator: string): Promise<number> {
    const [value] = await this.query('getVestingCountByCreator', [
      Address.newFromBech32(creator)
    ]);
    return num(value);
  }

  async idsByToken(
    token: string,
    from: number,
    count: number
  ): Promise<number[]> {
    const [raw] = await this.query('getVestingsByToken', [token, from, count]);
    return (raw as any[]).map(num);
  }

  async countByToken(token: string): Promise<number> {
    const [value] = await this.query('getVestingCountByToken', [token]);
    return num(value);
  }

  async tokenTotals(token: string): Promise<TokenTotals> {
    const [raw] = await this.query('getTokenTotals', [token]);
    return {
      deposited: big(raw.deposited),
      claimed: big(raw.claimed),
      refunded: big(raw.refunded)
    };
  }

  async vestingByClaimNonce(nonce: number): Promise<number> {
    const [value] = await this.query('getVestingByClaimNonce', [nonce]);
    return num(value);
  }

  async vestingByCancelNonce(nonce: number): Promise<number> {
    const [value] = await this.query('getVestingByCancelNonce', [nonce]);
    return num(value);
  }

  async fee(): Promise<bigint> {
    const [value] = await this.query('getFee');
    return big(value);
  }

  /**
   * The token fee in basis points (100 = 1%). The contract has it from
   * version 2 on; version 1 answers that the function does not exist, which
   * means no token fee. Any other failure is thrown: guessing 0 would build a
   * payment the contract refuses.
   */
  async tokenFee(): Promise<number> {
    try {
      const [value] = await this.query('getTokenFee');
      return num(value);
    } catch (failure) {
      if (
        /function not found|invalid function|getTokenFee/i.test(
          String((failure as any)?.message ?? failure)
        )
      )
        return 0;
      throw failure;
    }
  }

  async creationPaused(): Promise<boolean> {
    const [value] = await this.query('isCreationPaused');
    return Boolean(value);
  }

  async collections(): Promise<{ claim: string; cancel: string }> {
    const [[claim], [cancel]] = await Promise.all([
      this.query('getClaimKeyCollection'),
      this.query('getCancelKeyCollection')
    ]);
    return { claim: text(claim), cancel: text(cancel) };
  }

  async limits(): Promise<Limits> {
    try {
      const [raw] = await this.query('getLimits');
      return {
        maxBatch: num(raw.max_batch),
        maxBatchCancelable: num(raw.max_batch_cancelable),
        maxTranches: num(raw.max_tranches),
        maxLabelLen: num(raw.max_label_len),
        maxHorizon: num(raw.max_horizon),
        maxPage: num(raw.max_page)
      };
    } catch {
      return DEFAULT_LIMITS;
    }
  }

  // --------------------------------------------------------- transactions

  /**
   * What a creation pays: the totals plus the token fee in the vested token,
   * and the EGLD fee in EGLD (all of it in EGLD for an EGLD vesting).
   */
  private payment(token: string, total: bigint, tokenFee: bigint, fee: bigint) {
    if (token === EGLD)
      return {
        nativeTransferAmount: total + tokenFee + fee,
        tokenTransfers: [] as TokenTransfer[]
      };
    const transfers = [
      new TokenTransfer({
        token: new Token({ identifier: token }),
        amount: total + tokenFee
      })
    ];
    if (fee > 0n) transfers.push(TokenTransfer.newFromNativeAmount(fee));
    return { tokenTransfers: transfers };
  }

  /**
   * One vesting. Pays `total` plus its token fee (`tokenFeeBps`) of the
   * token, and the EGLD fee.
   */
  create(
    sender: string,
    token: string,
    entry: NewVesting,
    cancelable: boolean,
    label: string,
    fee: bigint,
    tokenFeeBps = 0
  ): Promise<Transaction> {
    return this.factory.createTransactionForExecute(
      Address.newFromBech32(sender),
      {
        contract: this.address,
        function: 'create',
        arguments: [
          Address.newFromBech32(entry.beneficiary),
          entry.total,
          scheduleArg(entry.schedule),
          cancelable,
          label
        ],
        gasLimit: 0n,
        ...this.payment(
          token,
          entry.total,
          tokenFeeOf(entry.total, tokenFeeBps),
          fee
        )
      }
    );
  }

  /** Many vestings of one token in one transaction (see batches.ts for limits). */
  createBatch(
    sender: string,
    token: string,
    entries: NewVesting[],
    cancelable: boolean,
    label: string,
    feePerVesting: bigint,
    tokenFeeBps = 0
  ): Promise<Transaction> {
    const sum = entries.reduce((total, entry) => total + entry.total, 0n);
    const tokenFee = tokenFeeOfAll(
      entries.map((entry) => entry.total),
      tokenFeeBps
    );
    const args: any[] = [cancelable, label];
    for (const entry of entries) {
      args.push([
        Address.newFromBech32(entry.beneficiary),
        entry.total,
        scheduleArg(entry.schedule)
      ]);
    }
    return this.factory.createTransactionForExecute(
      Address.newFromBech32(sender),
      {
        contract: this.address,
        function: 'createBatch',
        arguments: args,
        gasLimit: 0n,
        ...this.payment(
          token,
          sum,
          tokenFee,
          feePerVesting * BigInt(entries.length)
        )
      }
    );
  }

  /** Sends claim keys (collection `claimKey`, these nonces) to claim. */
  claim(
    sender: string,
    claimKey: string,
    nonces: number[]
  ): Promise<Transaction> {
    return this.keysCall(sender, 'claim', claimKey, nonces);
  }

  /** Sends cancel keys to cancel their vestings. */
  cancel(
    sender: string,
    cancelKey: string,
    nonces: number[]
  ): Promise<Transaction> {
    return this.keysCall(sender, 'cancel', cancelKey, nonces);
  }

  private keysCall(
    sender: string,
    fn: string,
    collection: string,
    nonces: number[]
  ) {
    return this.factory.createTransactionForExecute(
      Address.newFromBech32(sender),
      {
        contract: this.address,
        function: fn,
        arguments: [],
        gasLimit: 0n,
        tokenTransfers: nonces.map(
          (nonce) =>
            new TokenTransfer({
              token: new Token({
                identifier: collection,
                nonce: BigInt(nonce)
              }),
              amount: 1n
            })
        )
      }
    );
  }
}
