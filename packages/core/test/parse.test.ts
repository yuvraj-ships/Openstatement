import { describe, expect, it } from 'vitest';
import { parseLines, toCSV, toOFX, toQIF, templateFromResult, validateTemplate, type TextLine } from '../src/index.js';

/** Build text lines from rows of [x, text] pairs, 14pt apart. */
function lines(rows: [number, string][][], page = 1): TextLine[] {
  return rows.map((cells, i) => ({
    page,
    y: 100 + i * 14,
    cells: cells.map(([x, text]) => ({ x, text, width: text.length * 4.5 })),
  }));
}

describe('parseLines', () => {
  it('handles a whole row printed as one text run', () => {
    const result = parseLines(
      lines([
        [[40, '01/02/2026 Opening balance 500.00']],
        [[40, '02/02/2026 Coffee shop 4.50 495.50']],
        [[40, '03/02/2026 Refund from store 20.00 515.50']],
      ]),
    );
    expect(result.transactions.map((t) => [t.date, t.description, t.amount])).toEqual([
      ['2026-02-02', 'Coffee shop', -4.5],
      ['2026-02-03', 'Refund from store', 20],
    ]);
    expect(result.meta.openingBalance).toBe(500);
    expect(result.meta.confidence).toBe(1);
  });

  it('uses section titles when amounts have no sign and there is no balance', () => {
    const result = parseLines(
      lines([
        [[40, 'Deposits and additions']],
        [[40, '01/05'], [100, 'Payroll'], [400, '1,000.00']],
        [[40, 'Withdrawals']],
        [[40, '01/07'], [100, 'Grocery store'], [400, '55.20']],
        [[40, 'Statement period January 2026']],
      ]),
    );
    expect(result.transactions.map((t) => t.amount)).toEqual([1000, -55.2]);
    expect(result.transactions[0]!.date).toBe('2026-01-05');
  });

  it('gives undated rows the date of the row above', () => {
    const result = parseLines(
      lines([
        [[40, 'Date'], [100, 'Details'], [300, 'Debit'], [380, 'Credit'], [460, 'Balance']],
        [[40, '10/03/2026'], [100, 'Opening balance'], [460, '100.00']],
        [[40, '11/03/2026'], [100, 'Bakery'], [300, '3.00'], [460, '97.00']],
        [[100, 'Bus ticket'], [300, '2.00'], [460, '95.00']],
      ]),
    );
    expect(result.transactions.map((t) => [t.date, t.description, t.amount])).toEqual([
      ['2026-03-11', 'Bakery', -3],
      ['2026-03-11', 'Bus ticket', -2],
    ]);
  });

  it('fixes swapped debit/credit columns using the running balance', () => {
    // No header: the parser guesses left = debit, but this bank prints money in first.
    const result = parseLines(
      lines([
        [[40, '2026-04-01'], [100, 'Opening balance'], [520, '1,000.00']],
        [[40, '2026-04-02'], [100, 'Salary'], [370, '2,000.00'], [520, '3,000.00']],
        [[40, '2026-04-03'], [100, 'Rent'], [440, '900.00'], [520, '2,100.00']],
        [[40, '2026-04-04'], [100, 'Gift'], [370, '50.00'], [520, '2,150.00']],
      ]),
    );
    expect(result.transactions.map((t) => t.amount)).toEqual([2000, -900, 50]);
    expect(result.meta.balanceCheck).toEqual({ checked: 3, matched: 3 });
  });

  it('respects a user column mapping', () => {
    const base = lines([
      [[40, '01/01/2026'], [100, 'Thing'], [300, '10.00'], [400, '90.00']],
      [[40, '02/01/2026'], [100, 'Other'], [300, '5.00'], [400, '85.00']],
    ]);
    const auto = parseLines(base);
    const columns = auto.meta.columns.map((c) => (c.role === 'balance' ? { ...c, role: 'ignore' as const } : c));
    const result = parseLines(base, { columns });
    expect(result.transactions.every((t) => t.balance === undefined)).toBe(true);
  });

  it('warns on scanned PDFs', () => {
    expect(parseLines([]).meta.warnings[0]).toMatch(/scanned/);
  });

  it('infers the year for dates without one, across a year boundary', () => {
    const result = parseLines(
      lines([
        [[40, 'Statement period 15 Dec 2025 - 14 Jan 2026']],
        [[40, '20 Dec'], [100, 'Gift shop'], [400, '-30.00']],
        [[40, '05 Jan'], [100, 'Gym'], [400, '-25.00']],
      ]),
    );
    expect(result.transactions.map((t) => t.date)).toEqual(['2025-12-20', '2026-01-05']);
  });
});

describe('exports', () => {
  const result = parseLines(
    lines([
      [[40, 'Date'], [100, 'Description'], [300, 'Amount'], [400, 'Balance']],
      [[40, '01/15/2026'], [100, 'Coffee, "large"'], [300, '-4.50'], [400, '95.50']],
      [[40, '01/16/2026'], [100, 'Salary'], [300, '1,000.00'], [400, '1,095.50']],
    ]),
  );

  it('CSV escapes quotes and commas', () => {
    const csv = toCSV(result.transactions);
    expect(csv.split('\r\n')[1]).toBe('2026-01-15,"Coffee, ""large""",-4.50,4.50,,95.50,Dining,,');
  });

  it('CSV supports semicolons and decimal commas', () => {
    const csv = toCSV(result.transactions, { delimiter: ';', decimalComma: true, bom: true });
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv).toContain('2026-01-16;Salary;1000,00;;1000,00;1095,50;Income;;');
  });

  it('OFX has one STMTTRN per transaction and escapes text', () => {
    const ofx = toOFX(result, { currency: 'USD' });
    expect(ofx.match(/<STMTTRN>/g)).toHaveLength(2);
    expect(ofx).toContain('<TRNAMT>-4.50</TRNAMT>');
    expect(ofx).toContain('<DTPOSTED>20260115</DTPOSTED>');
    expect(ofx).toContain('<CURDEF>USD</CURDEF>');
  });

  it('QIF', () => {
    expect(toQIF(result.transactions)).toContain('D01/15/2026\nT-4.50\nPCoffee, "large"');
  });

  it('exports a valid template from a parse', () => {
    const t = templateFromResult(result, { id: 'xx-test-bank', name: 'Test Bank', country: 'xx', detect: ['Test Bank'] });
    expect(validateTemplate(t)).toMatchObject({ ok: true });
    expect(t.headers?.amount).toEqual(['Amount']);
    expect(t.dateOrder).toBe('MDY');
  });
});
