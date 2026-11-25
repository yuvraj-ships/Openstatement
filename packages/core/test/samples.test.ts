import { describe, expect, it } from 'vitest';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { parsePdf, type PdfJsLike } from '../src/index.js';
import { expected, renderSamplePdf, samples } from './fixtures/samples.js';

const lib = pdfjs as unknown as PdfJsLike;

describe('end-to-end: synthetic PDF statements', () => {
  for (const sample of samples) {
    it(`${sample.title}: ${sample.description}`, async () => {
      const pdf = await renderSamplePdf(sample);
      const result = await parsePdf(pdf, { pdfjs: lib });
      const want = expected(sample);

      expect(result.meta.warnings).toEqual([]);
      expect(result.transactions).toHaveLength(want.length);
      result.transactions.forEach((tx, i) => {
        const w = want[i]!;
        expect(tx.date, `row ${i} date`).toBe(w.date);
        expect(tx.amount, `row ${i} amount`).toBeCloseTo(w.amount, 2);
        expect(tx.balance, `row ${i} balance`).toBeCloseTo(w.balance, 2);
        expect(tx.description, `row ${i} description`).toContain(w.description);
        if (w.more) expect(tx.description).toContain(w.more);
      });
      expect(result.meta.currency).toBe(sample.currency);
      expect(result.meta.confidence).toBe(1);
    });
  }
});
