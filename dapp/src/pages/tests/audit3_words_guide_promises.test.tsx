// Third audit (Fable 5.1, 14 Oct 2026), words: two promises of the rewritten
// "How it works" page (c2bdacd, 5e76fe6).
//
// 1. The owner paragraph. Before the rewrite it read: "In the code as it
//    stands, it cannot pause claims or cancels and has no way to move locked
//    tokens. The contract can be upgraded by the multisig, so a serious bug
//    can be fixed, and an upgrade replaces the code: every promise on this
//    page holds for the code as it is, and the rest is trust in the multisig
//    and its signers." Now it reads: "It cannot pause claims or cancels and
//    has no way to move locked tokens. It can upgrade the contract, so a
//    serious bug can be fixed; every upgrade is a vote." The qualifier is
//    gone: "has no way to move locked tokens" is stated as absolute two
//    sentences before the page says the same owner can replace the code. The
//    first audit's RT5 and M2 rested on the page saying this plainly.
//
// 2. "load a CSV file of any length": the parser refuses a file of more than
//    MAX_CSV_LINES (5,000) beneficiaries ("At most 5000 beneficiaries per
//    file.").

import { act, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MAX_CSV_LINES, parseBeneficiaries } from 'vesting/csv';
import { Guide } from '../Guide';

jest.mock('chain/network', () => ({
  explorerUrl: 'https://explorer.multiversx.com'
}));
// Mainnet's fees on 14 Oct 2026: 0.1 EGLD and 10 bps.
jest.mock('chain/vesting', () => ({
  vesting: {
    fee: async () => 100_000_000_000_000_000n,
    tokenFee: async () => 10
  }
}));

const ADDRESS =
  'erd1u05m7s9u4dthgzzgxd0795kaxpadhj93yv24nydjczw832a66qlsgw5esx';

describe('audit 3, words: the guide', () => {
  beforeEach(async () => {
    render(
      <MemoryRouter>
        <Guide />
      </MemoryRouter>
    );
    for (let i = 0; i < 4; i++) await act(async () => undefined);
  });

  it('reads the live fees as mainnet has them (sound)', () => {
    expect(
      screen.getByText(/0\.1% of each vesting and 0\.1 EGLD per vesting/)
    ).toBeTruthy();
  });

  it('keeps the caveat that "cannot move locked tokens" holds for the code as it stands', () => {
    const owner = screen.getByText(/What the owner can and cannot do/)
      .parentElement!.textContent!;
    expect(owner).toMatch(/no way to move locked tokens/);
    expect(owner).toMatch(
      /code as it stands|code as it is|an upgrade replaces the code|trust in the multisig/
    );
  });

  it('does not promise a CSV "of any length" while the parser caps it', () => {
    const lines = ['address,amount'];
    for (let i = 0; i <= MAX_CSV_LINES; i++) lines.push(`${ADDRESS},1`);
    const parsed = parseBeneficiaries(lines.join('\n'), 18);
    expect(parsed.errors.map((e) => e.message).join(' ')).toMatch(
      /At most \d+ beneficiaries per file/
    );
    expect(screen.queryByText(/of any length/)).toBeNull();
  });
});
