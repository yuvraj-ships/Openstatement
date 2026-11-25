import { describe, expect, it } from 'vitest';
import {
  detectCurrency,
  detectDateOrder,
  detectNumberFormat,
  isAmount,
  parseAmount,
  readDate,
} from '../src/tokens.js';
import { resolveDate } from '../src/tokens.js';
import { roleForHeader } from '../src/headers.js';

describe('dates', () => {
  it.each([
    ['03/01/2026', 'DMY', { year: 2026, month: 1, day: 3 }],
    ['03/01/2026', 'MDY', { year: 2026, month: 3, day: 1 }],
    ['2026-01-31', 'DMY', { year: 2026, month: 1, day: 31 }],
    ['31.12.25', 'DMY', { year: 2025, month: 12, day: 31 }],
    ['05 Jan 2026', 'MDY', { year: 2026, month: 1, day: 5 }],
    ['5-Feb-26', 'DMY', { year: 2026, month: 2, day: 5 }],
    ['Mar 7, 2026', 'DMY', { year: 2026, month: 3, day: 7 }],
    ['12 Dez 2026', 'DMY', { year: 2026, month: 12, day: 12 }],
    ['4 févr. 2026', 'DMY', { year: 2026, month: 2, day: 4 }],
    ['15 ago 2026', 'DMY', { year: 2026, month: 8, day: 15 }],
    ['01.12.', 'DMY', { year: undefined, month: 12, day: 1 }],
  ] as const)('%s (%s)', (text, order, want) => {
    const raw = readDate(text);
    expect(raw).toBeDefined();
    expect(resolveDate(raw!, order)).toEqual(want);
  });

  it.each(['12.50', '1,234.56', 'Total', '45/67/2026', '2026', 'Jan', '123456'])('rejects %s', (text) => {
    expect(readDate(text)).toBeUndefined();
  });

  it('detects DMY from an impossible month', () => {
    expect(detectDateOrder(['01/02/2026', '25/02/2026'].map((d) => readDate(d)!))).toBe('DMY');
  });

  it('detects MDY from an impossible month', () => {
    expect(detectDateOrder(['01/02/2026', '02/25/2026'].map((d) => readDate(d)!))).toBe('MDY');
  });

  it('uses chronological order when every day is 12 or less', () => {
    // As MDY these are Jan 2, Jan 5, Jan 9 — as DMY they jump between months.
    expect(detectDateOrder(['01/02/2026', '01/05/2026', '01/09/2026'].map((d) => readDate(d)!))).toBe('MDY');
    expect(detectDateOrder(['02/01/2026', '05/01/2026', '09/01/2026'].map((d) => readDate(d)!))).toBe('DMY');
  });
});

describe('amounts', () => {
  it.each([
    ['1,234.56', 1234.56, 0],
    ['1.234,56', 1234.56, 0],
    ['1 234,56', 1234.56, 0],
    ["1'234.56", 1234.56, 0],
    ['-45.00', 45, -1],
    ['(45.00)', 45, -1],
    ['45.00-', 45, -1],
    ['45.00 DR', 45, -1],
    ['45.00Cr', 45, 1],
    ['+2.500,00', 2500, 1],
    ['$1,000.00', 1000, 0],
    ['-$12.30', 12.3, -1],
    ['€ 9,99', 9.99, 0],
    ['₹12,34,567.89', 1234567.89, 0],
    ['1,500.00 EUR', 1500, 0],
  ] as const)('%s', (text, value, sign) => {
    expect(isAmount(text)).toBe(true);
    expect(parseAmount(text)).toEqual({ value, sign });
  });

  it.each(['2026', '000412345678', 'Page 1', 'ATM', '12/01'])('is not an amount: %s', (text) => {
    expect(isAmount(text)).toBe(false);
  });

  it('allows whole numbers in loose mode (JPY, KRW)', () => {
    expect(isAmount('12,000', false)).toBe(true);
    expect(parseAmount('12,000')).toEqual({ value: 12000, sign: 0 });
  });

  it('detects the decimal separator', () => {
    expect(detectNumberFormat(['1.234,56', '12,00', '-3,10'])).toEqual({ decimal: ',' });
    expect(detectNumberFormat(['1,234.56', '12.00'])).toEqual({ decimal: '.' });
  });
});

describe('currency', () => {
  it('finds the most common currency', () => {
    expect(detectCurrency('Statement in EUR. Saldo 1.000,00 EUR')).toBe('EUR');
    expect(detectCurrency('Total £120.00')).toBe('GBP');
    expect(detectCurrency('Balance ₹1,000.00')).toBe('INR');
    expect(detectCurrency('Balance $1,000.00')).toBe('USD');
  });
});

describe('headers', () => {
  it.each([
    ['Withdrawal Amt.', 'debit'],
    ['Deposit Amt.', 'credit'],
    ['Paid out', 'debit'],
    ['Paid in', 'credit'],
    ['Closing Balance', 'balance'],
    ['Value Dt', 'valueDate'],
    ['Transaction Date', 'date'],
    ['Buchungstag', 'date'],
    ['Verwendungszweck', 'description'],
    ['Betrag (EUR)', 'amount'],
    ['Soll', 'debit'],
    ['Haben', 'credit'],
    ['Libellé', 'description'],
    ['Débit', 'debit'],
    ['Crédit', 'credit'],
    ['Saldo', 'balance'],
    ['Concepto', 'description'],
    ['Importe', 'amount'],
    ['Dr/Cr', 'sign'],
    ['Chq./Ref.No.', 'reference'],
  ] as const)('%s → %s', (label, role) => {
    expect(roleForHeader(label)).toBe(role);
  });
});
