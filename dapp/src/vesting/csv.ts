// Beneficiaries from a CSV: one line per vesting, an address and an amount.
// Every line is checked before anything is built, and every problem is reported
// with its line number: a wrong address in a vesting is money sent to nobody.

import { Address } from '@multiversx/sdk-core';
import { parseAmount } from './format';

export interface Beneficiary {
  /** 1-based line in the file, for messages. */
  line: number;
  address: string;
  amount: bigint;
}

export interface CsvResult {
  rows: Beneficiary[];
  errors: { line: number; message: string }[];
  /** Addresses that appear more than once: allowed, but worth a look. */
  repeated: string[];
}

/** Most lines one file may hold. */
export const MAX_CSV_LINES = 5_000;

const isAddress = (value: string) =>
  /^erd1[02-9ac-hj-np-z]{58}$/.test(value) && Address.isValid(value);

const splitLine = (line: string): string[] => {
  // Tab or semicolon when the file uses one; otherwise a comma, which then
  // cannot also be a thousands separator unless the amount is quoted.
  const separator = line.includes('\t') ? '\t' : line.includes(';') ? ';' : ',';
  const cells: string[] = [];
  let cell = '';
  let quoted = false;
  for (const char of line) {
    if (char === '"') quoted = !quoted;
    else if (char === separator && !quoted) {
      cells.push(cell);
      cell = '';
    } else cell += char;
  }
  cells.push(cell);
  return cells.map((value) => value.trim());
};

/** Parses "address,amount" lines; a header line and blank lines are skipped. */
export const parseBeneficiaries = (
  text: string,
  decimals: number
): CsvResult => {
  const rows: Beneficiary[] = [];
  const errors: CsvResult['errors'] = [];
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  if (lines.filter((line) => line.trim()).length > MAX_CSV_LINES) {
    return {
      rows,
      errors: [
        { line: 0, message: `At most ${MAX_CSV_LINES} lines per file.` }
      ],
      repeated: []
    };
  }
  lines.forEach((raw, index) => {
    const line = index + 1;
    if (!raw.trim()) return;
    const [address = '', amountText = '', ...rest] = splitLine(raw);
    if (index === 0 && !address.startsWith('erd1')) return; // a header
    if (rest.some((cell) => cell !== '')) {
      errors.push({
        line,
        message: 'Expected two columns: address and amount.'
      });
      return;
    }
    if (!isAddress(address.toLowerCase())) {
      errors.push({
        line,
        message: `Not a valid MultiversX address: ${address || '(empty)'}`
      });
      return;
    }
    const amount = parseAmount(amountText, decimals);
    if (amount === null) {
      errors.push({
        line,
        message: `Not a valid amount: ${amountText || '(empty)'} (at most ${decimals} decimals)`
      });
      return;
    }
    if (amount === 0n) {
      errors.push({ line, message: 'The amount must be more than zero.' });
      return;
    }
    rows.push({ line, address: address.toLowerCase(), amount });
  });
  const seen = new Map<string, number>();
  for (const row of rows)
    seen.set(row.address, (seen.get(row.address) ?? 0) + 1);
  const repeated = [...seen]
    .filter(([, count]) => count > 1)
    .map(([address]) => address);
  return { rows, errors, repeated };
};

/** Back to CSV, for an export: address, amount in token units as text. */
export const toCsv = (header: string[], lines: (string | number)[][]) =>
  [header, ...lines]
    .map((cells) =>
      cells
        .map((cell) => {
          const text = String(cell);
          return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
        })
        .join(',')
    )
    .join('\n') + '\n';
