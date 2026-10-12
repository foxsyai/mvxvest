// Beneficiaries from a CSV: one line per vesting, an address and an amount.
// Every line is checked before anything is built, and every problem is reported
// with its line number: a wrong address in a vesting is money sent to nobody.

import { Address } from '@multiversx/sdk-core';
import { amountProblem, parseAmount } from './format';

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

/** A first line that names its columns rather than holding a vesting. */
const isHeader = (address: string, amount: string) =>
  !isAddress(address.toLowerCase()) &&
  !/^erd1/i.test(address) &&
  !/^[\d.,\s_]+$/.test(amount);

/**
 * Parses "address,amount" lines; blank lines are skipped, and so is a header
 * when the file has one (`header`: a first line whose cells are neither an
 * address nor a number). Rows typed one by one pass `header: false`: their
 * first line is always a vesting, so a typo in it is an error, never skipped.
 */
export const parseBeneficiaries = (
  text: string,
  decimals: number,
  { header = true }: { header?: boolean } = {}
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
    if (
      header &&
      rows.length + errors.length === 0 &&
      isHeader(address, amountText)
    )
      return;
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
        message: `Not a valid amount: ${amountText || '(empty)'} (${amountProblem(amountText, decimals)})`
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

/**
 * One CSV cell. Text a spreadsheet would run as a formula (= + - @, or a tab or
 * carriage return before one) gets a leading apostrophe: labels are anyone's
 * bytes on chain. Plain numbers, negative ones included, are left alone.
 */
const csvCell = (cell: string | number) => {
  let text = String(cell);
  if (typeof cell !== 'number' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

/** Back to CSV, for an export: address, amount in token units as text. */
export const toCsv = (header: string[], lines: (string | number)[][]) =>
  [header, ...lines].map((cells) => cells.map(csvCell).join(',')).join('\n') +
  '\n';
