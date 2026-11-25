import { describe, expect, it } from 'vitest';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { getInsights, merchantKey, mergeStatements, parsePdf, toCSV, type PdfJsLike, type Transaction } from '../src/index.js';
import { quarter, quarterOpening, quarterTxs, renderSamplePdf } from './fixtures/samples.js';

const lib = pdfjs as unknown as PdfJsLike;
const tx = (date: string, description: string, amount: number, balance?: number): Transaction => ({
  date,
  description,
  amount,
  page: 1,
  ...(balance !== undefined ? { balance } : {}),
});

describe('mergeStatements', () => {
  it('removes rows repeated across statements but keeps real duplicates inside one', () => {
    const a = [tx('2026-01-01', 'Coffee', -3), tx('2026-01-01', 'Coffee', -3), tx('2026-01-02', 'Rent', -900)];
    const b = [tx('2026-01-02', 'Rent', -900), tx('2026-01-03', 'Salary', 2000)];
    const merged = mergeStatements([
      { name: 'jan-a.pdf', transactions: a },
      { name: 'jan-b.pdf', transactions: b },
    ]);
    expect(merged.transactions.map((t) => t.description)).toEqual(['Coffee', 'Coffee', 'Rent', 'Salary']);
    expect(merged.duplicatesRemoved).toBe(1);
    expect(merged.transactions[3]!.source).toBe('jan-b.pdf');
  });

  it('sorts statements given in any order', () => {
    const merged = mergeStatements([
      { name: 'feb', transactions: [tx('2026-02-01', 'B', -1)] },
      { name: 'jan', transactions: [tx('2026-01-01', 'A', -1)] },
    ]);
    expect(merged.transactions.map((t) => t.date)).toEqual(['2026-01-01', '2026-02-01']);
  });

  it('end-to-end: three monthly PDFs with an overlap become one clean year-to-date list', async () => {
    const parsed = await Promise.all(
      quarter.map(async (s) => ({ name: s.id, ...(await parsePdf(await renderSamplePdf(s), { pdfjs: lib })) })),
    );
    for (const p of parsed) expect(p.meta.confidence).toBe(1);

    const merged = mergeStatements(parsed);
    expect(merged.duplicatesRemoved).toBe(2); // Feb 26 + Feb 27 were in both February and March
    expect(merged.transactions).toHaveLength(quarterTxs.length);

    let bal = quarterOpening;
    merged.transactions.forEach((t, i) => {
      bal = Math.round((bal + quarterTxs[i]!.amount) * 100) / 100;
      expect(t.date).toBe(quarterTxs[i]!.date);
      expect(t.amount).toBeCloseTo(quarterTxs[i]!.amount, 2);
      expect(t.balance).toBeCloseTo(bal, 2);
    });

    const csv = toCSV(merged.transactions);
    expect(csv.split('\r\n')[0]).toMatch(/,Statement$/);
  });
});

describe('getInsights', () => {
  const txs: Transaction[] = quarterTxs.map((t) => ({ ...tx(t.date, t.description, t.amount), category: t.amount > 0 ? 'Income' : 'Other' }));
  const insights = getInsights(txs);

  it('summarises each month', () => {
    expect(insights.months.map((m) => m.month)).toEqual(['2026-01', '2026-02', '2026-03']);
    expect(insights.months[0]).toMatchObject({ moneyIn: 2500, moneyOut: 1450.1, net: 1049.9, count: 8 });
    expect(insights.totals.moneyIn).toBe(7560);
  });

  it('finds the biggest expense and income', () => {
    expect(insights.biggestExpense?.amount).toBe(-1200);
    expect(insights.biggestIncome?.amount).toBe(2500);
  });

  it('finds monthly recurring payments, not variable shopping', () => {
    const names = insights.recurring.map((r) => r.name);
    expect(names).toEqual(
      expect.arrayContaining(['ONLINE TRANSFER TO LANDLORD RENT', 'NETFLIX.COM', 'SPOTIFY USA', 'IRONWORKS GYM MEMBERSHIP']),
    );
    expect(names).not.toContain('WHOLE FOODS MARKET #1021');
    expect(names).not.toContain('UBER TRIP');
    const netflix = insights.recurring.find((r) => r.name === 'NETFLIX.COM')!;
    expect(netflix).toMatchObject({ amount: 15.49, months: 3, perYear: 185.88 });
    expect(insights.recurring[0]!.name).toBe('ONLINE TRANSFER TO LANDLORD RENT');
  });

  it('compares the top category with the previous month', () => {
    expect(insights.categoryChange).toMatchObject({ category: 'Other', month: '2026-03', previousMonth: '2026-02' });
  });

  it('handles an empty list', () => {
    expect(getInsights([])).toMatchObject({ months: [], recurring: [], averageMonthlySpend: 0 });
  });

  it('merchantKey ignores numbers and punctuation', () => {
    expect(merchantKey('UPI/NETFLIX.COM/0001234/Monthly')).toBe('upi netflix com');
    expect(merchantKey('WHOLE FOODS MARKET #1021')).toBe('whole foods market');
  });
});
