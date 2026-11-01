// Fifth audit (KEYS): the dApp's port of the vesting maths on the same
// hand-worked table the contract runs in
// contracts/vesting/tests/audit5_keys_schedule_edges.rs: expected values
// derived by hand, not printed by either implementation, so both are checked
// against the spec rather than against each other. Passes: checked sound.

import {
  nextRelease,
  Schedule,
  SCHEDULE_ERRORS,
  validateSchedule,
  vestedAt,
  vestedWithCancel
} from '../schedule';

type Sample = [t: number, vested: bigint, next: [number, bigint] | null];

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
  list: [number, bigint][]
): Schedule => ({
  start,
  cliff,
  cliffAmount,
  end: list.length ? list[list.length - 1][0] : start,
  curve: {
    kind: 'tranches',
    tranches: list.map(([time, amount]) => ({ time, amount }))
  }
});

const check = (
  name: string,
  schedule: Schedule,
  total: bigint,
  samples: Sample[]
) => {
  expect(validateSchedule(schedule, total)).toBeNull();
  for (const [t, vested, next] of samples) {
    expect([name, t, vestedAt(schedule, total, t)]).toEqual([name, t, vested]);
    expect([name, t, nextRelease(schedule, total, t)]).toEqual([name, t, next]);
  }
};

const MAX = Number.MAX_SAFE_INTEGER;

describe('the dApp maths at the edges of the fifth audit', () => {
  it('stepped interval not dividing the duration', () => {
    check('stepped 10 s by 3', stepped(100, 100, 0n, 110, 3), 7n, [
      [99, 0n, [103, 1n]],
      [100, 0n, [103, 1n]],
      [102, 0n, [103, 1n]],
      [103, 1n, [106, 2n]],
      [105, 1n, [106, 2n]],
      [106, 3n, [109, 2n]],
      [108, 3n, [109, 2n]],
      [109, 5n, [110, 2n]],
      [110, 7n, null],
      [MAX, 7n, null]
    ]);
  });

  it('one unit over a long linear curve vests only at the end', () => {
    check('1 unit over 1000 s', linear(0, 0, 0n, 1000), 1n, [
      [0, 0n, [1000, 1n]],
      [999, 0n, [1000, 1n]],
      [1000, 1n, null]
    ]);
  });

  it('a cliff amount at the start of a linear curve', () => {
    check('cliff amount at start', linear(0, 0, 40n, 100), 100n, [
      [0, 40n, [2, 1n]],
      [1, 40n, [2, 1n]],
      [2, 41n, [4, 1n]],
      [50, 70n, [52, 1n]],
      [99, 99n, [100, 1n]],
      [100, 100n, null]
    ]);
  });

  it('tranches before the cliff, and nothing at the cliff', () => {
    check(
      'catch-up tranches',
      tranches(0, 30, 0n, [
        [10, 5n],
        [20, 5n],
        [100, 90n]
      ]),
      100n,
      [
        [0, 0n, [30, 10n]],
        [29, 0n, [30, 10n]],
        [30, 10n, [100, 90n]],
        [99, 10n, [100, 90n]],
        [100, 100n, null]
      ]
    );
    check(
      'empty cliff',
      tranches(0, 5, 0n, [
        [50, 1n],
        [100, 1n]
      ]),
      2n,
      [
        [0, 0n, [50, 1n]],
        [5, 0n, [50, 1n]],
        [49, 0n, [50, 1n]],
        [50, 1n, [100, 1n]],
        [100, 2n, null]
      ]
    );
  });

  it('a stepped curve with a cliff amount and a cliff after two steps', () => {
    check('stepped with cliff', stepped(0, 25, 10n, 100, 10), 110n, [
      [0, 0n, [25, 30n]],
      [24, 0n, [25, 30n]],
      [25, 30n, [30, 10n]],
      [29, 30n, [30, 10n]],
      [30, 40n, [40, 10n]],
      [99, 100n, [100, 10n]],
      [100, 110n, null]
    ]);
  });

  it('a time lock at timestamp zero, and one tranche at the start', () => {
    check('lock at 0', linear(0, 0, 0n, 0), 5n, [
      [0, 5n, null],
      [1, 5n, null],
      [MAX, 5n, null]
    ]);
    check('one tranche', tranches(100, 100, 0n, [[100, 7n]]), 7n, [
      [0, 0n, [100, 7n]],
      [99, 0n, [100, 7n]],
      [100, 7n, null]
    ]);
  });

  it('120 tranches of one unit each second', () => {
    const list: [number, bigint][] = Array.from({ length: 120 }, (_, i) => [
      i + 1,
      1n
    ]);
    check('120 tranches', tranches(0, 0, 0n, list), 120n, [
      [0, 0n, [1, 1n]],
      [1, 1n, [2, 1n]],
      [60, 60n, [61, 1n]],
      [119, 119n, [120, 1n]],
      [120, 120n, null]
    ]);
  });

  it('a tiny total over two billion seconds', () => {
    check('3 over 2e9', linear(0, 0, 0n, 2_000_000_000), 3n, [
      [0, 0n, [666_666_667, 1n]],
      [666_666_666, 0n, [666_666_667, 1n]],
      [666_666_667, 1n, [1_333_333_334, 1n]],
      [1_999_999_999, 2n, [2_000_000_000, 1n]],
      [2_000_000_000, 3n, null]
    ]);
  });

  it('freezes at the cancel, before and after it', () => {
    const s = linear(0, 0, 40n, 100);
    expect(vestedWithCancel(s, 100n, 50, 100)).toBe(70n);
    expect(vestedWithCancel(s, 100n, 50, 50)).toBe(70n);
    expect(vestedWithCancel(s, 100n, 50, 49)).toBe(69n);
    expect(vestedWithCancel(s, 100n, 0, 100)).toBe(100n);
  });

  it('refuses every malformed edge the contract refuses', () => {
    const many: [number, bigint][] = Array.from({ length: 121 }, (_, i) => [
      i + 1,
      1n
    ]);
    const cases: [string, Schedule, bigint, string][] = [
      ['zero total', linear(0, 0, 0n, 10), 0n, SCHEDULE_ERRORS.zeroTotal],
      [
        'cliff before start',
        linear(10, 9, 0n, 20),
        100n,
        SCHEDULE_ERRORS.timeOrder
      ],
      [
        'cliff after end',
        linear(0, 21, 0n, 20),
        100n,
        SCHEDULE_ERRORS.timeOrder
      ],
      [
        'cliff amount above total',
        linear(0, 0, 101n, 20),
        100n,
        SCHEDULE_ERRORS.cliffAboveTotal
      ],
      [
        'zero interval',
        stepped(0, 0, 0n, 20, 0),
        100n,
        SCHEDULE_ERRORS.zeroInterval
      ],
      [
        'interval longer than the schedule',
        stepped(0, 0, 0n, 20, 21),
        100n,
        SCHEDULE_ERRORS.intervalTooLong
      ],
      [
        'stepped with an empty duration',
        stepped(20, 20, 0n, 20, 1),
        100n,
        SCHEDULE_ERRORS.intervalTooLong
      ],
      [
        'no tranches',
        tranches(0, 0, 0n, []),
        100n,
        SCHEDULE_ERRORS.trancheCount
      ],
      [
        '121 tranches',
        tranches(0, 0, 0n, many),
        121n,
        SCHEDULE_ERRORS.trancheCount
      ],
      [
        'zero tranche',
        tranches(0, 0, 0n, [
          [10, 0n],
          [20, 100n]
        ]),
        100n,
        SCHEDULE_ERRORS.zeroTranche
      ],
      [
        'tranche before start',
        tranches(10, 10, 0n, [
          [9, 50n],
          [20, 50n]
        ]),
        100n,
        SCHEDULE_ERRORS.trancheBeforeStart
      ],
      [
        'duplicate times',
        tranches(0, 0, 0n, [
          [10, 50n],
          [10, 50n]
        ]),
        100n,
        SCHEDULE_ERRORS.trancheOrder
      ],
      [
        'unsorted',
        tranches(0, 0, 0n, [
          [20, 50n],
          [10, 50n]
        ]),
        100n,
        SCHEDULE_ERRORS.trancheOrder
      ],
      [
        'last tranche not at the end',
        {
          ...tranches(0, 0, 0n, [
            [10, 50n],
            [20, 50n]
          ]),
          end: 30
        },
        100n,
        SCHEDULE_ERRORS.lastTrancheNotEnd
      ],
      [
        'sum below the total',
        tranches(0, 0, 0n, [
          [10, 50n],
          [20, 49n]
        ]),
        100n,
        SCHEDULE_ERRORS.trancheSum
      ],
      [
        'sum above the total',
        tranches(0, 0, 0n, [
          [10, 50n],
          [20, 51n]
        ]),
        100n,
        SCHEDULE_ERRORS.trancheSum
      ],
      [
        'sum plus cliff amount above',
        tranches(0, 0, 1n, [
          [10, 50n],
          [20, 50n]
        ]),
        100n,
        SCHEDULE_ERRORS.trancheSum
      ]
    ];
    for (const [name, schedule, total, error] of cases) {
      expect([name, validateSchedule(schedule, total)]).toEqual([name, error]);
    }
  });
});
