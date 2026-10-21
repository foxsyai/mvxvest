// Fourth audit (Claude Fable 5.1, 20 Oct 2026), reviewer SCK: the dApp's port
// of the vesting maths against the contract's own answers at hand-picked
// extremes the random vectors do not reach: a time lock, a cliff at the end,
// a cliff amount equal to the total, a stepped curve releasing fewer units
// than it has steps, a short last step, one step as long as the schedule, a
// schedule not yet started, catch-up cliffs, 10^30 units over 30 years, and
// times next to 2^53. The expected values were printed by the Rust code
// (contracts/vesting/src/schedule.rs) at 322cb43. Passes: checked sound.

import {
  nextRelease,
  Schedule,
  SCHEDULE_ERRORS,
  validateSchedule,
  vestedAt,
  vestedWithCancel
} from '../schedule';

type Sample = [t: number, vested: string, next: [number, string] | null];

interface Case {
  name: string;
  total: bigint;
  schedule: Schedule;
  samples: Sample[];
}

const linear = (
  start: number,
  cliff: number,
  cliffAmount: bigint,
  end: number
): Schedule => ({ start, cliff, cliffAmount, end, curve: { kind: 'linear' } });

const stepped = (
  start: number,
  cliff: number,
  cliffAmount: bigint,
  end: number,
  interval: number
): Schedule => ({
  start,
  cliff,
  cliffAmount,
  end,
  curve: { kind: 'stepped', interval }
});

const tranches = (
  start: number,
  cliff: number,
  cliffAmount: bigint,
  end: number,
  list: [number, bigint][]
): Schedule => ({
  start,
  cliff,
  cliffAmount,
  end,
  curve: {
    kind: 'tranches',
    tranches: list.map(([time, amount]) => ({ time, amount }))
  }
});

const cases: Case[] = [
  {
    name: 'time lock: start = cliff = end',
    total: 1000n,
    schedule: linear(100, 100, 0n, 100),
    samples: [
      [0, '0', [100, '1000']],
      [99, '0', [100, '1000']],
      [100, '1000', null],
      [101, '1000', null]
    ]
  },
  {
    name: 'cliff at the end with a cliff amount',
    total: 1000n,
    schedule: linear(0, 100, 300n, 100),
    samples: [
      [0, '0', [100, '1000']],
      [99, '0', [100, '1000']],
      [100, '1000', null]
    ]
  },
  {
    name: 'cliff amount equal to the total, linear',
    total: 1000n,
    schedule: linear(0, 10, 1000n, 100),
    samples: [
      [0, '0', [10, '1000']],
      [9, '0', [10, '1000']],
      [10, '1000', null],
      [50, '1000', null],
      [100, '1000', null]
    ]
  },
  {
    name: 'cliff amount equal to the total, stepped',
    total: 1000n,
    schedule: stepped(0, 10, 1000n, 100, 10),
    samples: [
      [0, '0', [10, '1000']],
      [9, '0', [10, '1000']],
      [10, '1000', null],
      [50, '1000', null],
      [100, '1000', null]
    ]
  },
  {
    name: 'stepped releasing fewer units than it has steps',
    total: 2n,
    schedule: stepped(0, 0, 0n, 100, 10),
    samples: [
      [0, '0', [50, '1']],
      [49, '0', [50, '1']],
      [50, '1', [100, '1']],
      [51, '1', [100, '1']],
      [99, '1', [100, '1']],
      [100, '2', null]
    ]
  },
  {
    name: 'stepped with a short last step',
    total: 1000n,
    schedule: stepped(0, 0, 0n, 100, 30),
    samples: [
      [0, '0', [30, '250']],
      [29, '0', [30, '250']],
      [30, '250', [60, '250']],
      [59, '250', [60, '250']],
      [60, '500', [90, '250']],
      [89, '500', [90, '250']],
      [90, '750', [100, '250']],
      [99, '750', [100, '250']],
      [100, '1000', null]
    ]
  },
  {
    name: 'one step as long as the schedule',
    total: 1000n,
    schedule: stepped(0, 0, 0n, 100, 100),
    samples: [
      [0, '0', [100, '1000']],
      [99, '0', [100, '1000']],
      [100, '1000', null]
    ]
  },
  {
    name: 'linear releasing a unit every 333 seconds',
    total: 3n,
    schedule: linear(0, 0, 0n, 1000),
    samples: [
      [0, '0', [334, '1']],
      [333, '0', [334, '1']],
      [334, '1', [667, '1']],
      [666, '1', [667, '1']],
      [667, '2', [1000, '1']],
      [999, '2', [1000, '1']],
      [1000, '3', null]
    ]
  },
  {
    name: 'not started yet',
    total: 1000n,
    schedule: linear(100, 100, 0n, 200),
    samples: [
      [0, '0', [101, '10']],
      [99, '0', [101, '10']],
      [100, '0', [101, '10']],
      [101, '10', [102, '10']],
      [199, '990', [200, '10']]
    ]
  },
  {
    name: 'tranches before the cliff unlock at the cliff',
    total: 1000n,
    schedule: tranches(0, 50, 0n, 100, [
      [10, 100n],
      [20, 100n],
      [100, 800n]
    ]),
    samples: [
      [0, '0', [50, '200']],
      [10, '0', [50, '200']],
      [49, '0', [50, '200']],
      [50, '200', [100, '800']],
      [99, '200', [100, '800']],
      [100, '1000', null]
    ]
  },
  {
    name: 'a linear curve catching up at the cliff',
    total: 1000n,
    schedule: linear(0, 30, 100n, 100),
    samples: [
      [0, '0', [30, '370']],
      [29, '0', [30, '370']],
      [30, '370', [31, '9']],
      [31, '379', [32, '9']],
      [99, '991', [100, '9']],
      [100, '1000', null]
    ]
  },
  {
    name: '10^30 units over 30 years',
    total: 10n ** 30n,
    schedule: linear(0, 0, 0n, 946080000),
    samples: [
      [0, '0', [1, '1056993066125486216810']],
      [1, '1056993066125486216810', [2, '1056993066125486216810']],
      [2, '2113986132250972433620', [3, '1056993066125486216811']],
      [
        946079999,
        '999999998943006933874513783189',
        [946080000, '1056993066125486216811']
      ],
      [946080000, '1000000000000000000000000000000', null]
    ]
  },
  {
    name: '10^29 at a cliff after 500M seconds, then daily steps',
    total: 10n ** 30n,
    schedule: stepped(0, 500000000, 10n ** 29n, 946080000, 86400),
    samples: [
      [0, '0', [500000000, '575643835616438356164383561643']],
      [499999999, '0', [500000000, '575643835616438356164383561643']],
      [
        500000000,
        '575643835616438356164383561643',
        [500083200, '82191780821917808219178083']
      ],
      [
        500083200,
        '575726027397260273972602739726',
        [500169600, '82191780821917808219178082']
      ],
      [
        946079999,
        '999917808219178082191780821917',
        [946080000, '82191780821917808219178083']
      ]
    ]
  },
  {
    name: 'times next to 2^53',
    total: 991n,
    schedule: linear(9007199254740000, 9007199254740000, 0n, 9007199254740991),
    samples: [
      [9007199254740000, '0', [9007199254740001, '1']],
      [9007199254740500, '500', [9007199254740501, '1']],
      [9007199254740990, '990', [9007199254740991, '1']],
      [9007199254740991, '991', null]
    ]
  }
];

describe('the dApp maths matches the contract at the extremes', () => {
  it.each(cases.map((c) => [c.name, c] as const))('%s', (_, c) => {
    expect(validateSchedule(c.schedule, c.total)).toBeNull();
    for (const [t, vested, next] of c.samples) {
      expect(vestedAt(c.schedule, c.total, t).toString()).toBe(vested);
      const ours = nextRelease(c.schedule, c.total, t);
      expect(ours === null ? null : [ours[0], ours[1].toString()]).toEqual(
        next
      );
    }
  });

  it('refuses at the edges what the contract refuses', () => {
    // A stepped curve with an empty duration: no interval fits.
    expect(validateSchedule(stepped(100, 100, 0n, 100, 1), 1000n)).toBe(
      SCHEDULE_ERRORS.intervalTooLong
    );
    expect(validateSchedule(stepped(0, 0, 0n, 100, 100), 1000n)).toBeNull();
    expect(validateSchedule(stepped(0, 0, 0n, 100, 101), 1000n)).toBe(
      SCHEDULE_ERRORS.intervalTooLong
    );
    // Tranches cannot carry a cliff amount equal to the total.
    expect(
      validateSchedule(tranches(0, 10, 1000n, 100, [[100, 1n]]), 1000n)
    ).toBe(SCHEDULE_ERRORS.trancheSum);
    expect(
      validateSchedule(
        tranches(0, 0, 0n, 10, [
          [10, 500n],
          [10, 500n]
        ]),
        1000n
      )
    ).toBe(SCHEDULE_ERRORS.trancheOrder);
    expect(
      validateSchedule(
        tranches(0, 0, 0n, 20, [
          [10, 1000n],
          [20, 0n]
        ]),
        1000n
      )
    ).toBe(SCHEDULE_ERRORS.zeroTranche);
    expect(
      validateSchedule(
        tranches(5, 5, 0n, 20, [
          [4, 500n],
          [20, 500n]
        ]),
        1000n
      )
    ).toBe(SCHEDULE_ERRORS.trancheBeforeStart);
    expect(validateSchedule(tranches(0, 0, 0n, 20, [[10, 1000n]]), 1000n)).toBe(
      SCHEDULE_ERRORS.lastTrancheNotEnd
    );
    expect(validateSchedule(tranches(0, 0, 0n, 20, []), 1000n)).toBe(
      SCHEDULE_ERRORS.trancheCount
    );
    const many = (n: number): [number, bigint][] =>
      Array.from({ length: n }, (_, i) => [i + 1, 1n]);
    expect(
      validateSchedule(tranches(0, 0, 0n, 120, many(120)), 120n)
    ).toBeNull();
    expect(validateSchedule(tranches(0, 0, 0n, 121, many(121)), 121n)).toBe(
      SCHEDULE_ERRORS.trancheCount
    );
    // A one-tranche time lock.
    expect(
      validateSchedule(tranches(100, 100, 0n, 100, [[100, 1000n]]), 1000n)
    ).toBeNull();
  });

  it('freezes at the cancel even at the end of time', () => {
    const schedule = linear(0, 0, 0n, 1000);
    expect(
      vestedWithCancel(schedule, 1000n, 300, Number.MAX_SAFE_INTEGER)
    ).toBe(300n);
    expect(vestedWithCancel(schedule, 1000n, 300, 299)).toBe(299n);
    expect(vestedWithCancel(schedule, 1000n, 0, Number.MAX_SAFE_INTEGER)).toBe(
      1000n
    );
  });
});
