import type { ParseOptions, ParseResult, TextCell, TextLine } from './types.js';
import { parseLines } from './parse.js';

/**
 * The small part of pdf.js (`pdfjs-dist`) that openstatement uses. Pass the module in, so the
 * library works the same in browsers, Node, Deno and bundlers, and never loads anything itself.
 *
 *   Browser: import * as pdfjs from 'pdfjs-dist'
 *   Node:    import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
 */
export interface PdfJsLike {
  getDocument(src: { data: Uint8Array; password?: string; [k: string]: unknown }): { promise: Promise<PdfDocumentLike> };
}

interface PdfDocumentLike {
  numPages: number;
  getPage(n: number): Promise<{
    getViewport(o: { scale: number }): { height: number };
    getTextContent(): Promise<{ items: unknown[] }>;
  }>;
  destroy?: () => Promise<void> | void;
}

interface TextItem {
  str: string;
  transform: number[];
  width: number;
  height: number;
}

/** Thrown when a PDF is password protected (many banks do this). */
export class PdfPasswordError extends Error {
  constructor(public readonly reason: 'required' | 'incorrect') {
    super(reason === 'required' ? 'This PDF is password protected.' : 'The PDF password is incorrect.');
    this.name = 'PdfPasswordError';
  }
}

export interface ReadPdfOptions {
  pdfjs: PdfJsLike;
  password?: string;
}

/** Extract positioned text lines from a PDF. */
export async function readPdf(data: Uint8Array | ArrayBuffer, { pdfjs, password }: ReadPdfOptions): Promise<TextLine[]> {
  const bytes = data instanceof Uint8Array ? new Uint8Array(data) : new Uint8Array(data);
  let doc: PdfDocumentLike;
  try {
    doc = await pdfjs.getDocument({
      data: bytes,
      ...(password ? { password } : {}),
      isEvalSupported: false,
      useSystemFonts: false,
      disableFontFace: true,
      verbosity: 0,
    }).promise;
  } catch (err) {
    const e = err as { name?: string; code?: number };
    if (e?.name === 'PasswordException') throw new PdfPasswordError(e.code === 2 ? 'incorrect' : 'required');
    throw err;
  }

  const lines: TextLine[] = [];
  try {
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const height = page.getViewport({ scale: 1 }).height;
      const content = await page.getTextContent();
      const items = (content.items as TextItem[]).filter((i) => typeof i.str === 'string' && i.str.trim() !== '');
      lines.push(...groupLines(items, height, p));
    }
  } finally {
    await doc.destroy?.();
  }
  return lines;
}

/** Read a statement PDF and parse it into transactions in one call. */
export async function parsePdf(
  data: Uint8Array | ArrayBuffer,
  options: ReadPdfOptions & ParseOptions,
): Promise<ParseResult & { lines: TextLine[] }> {
  const lines = await readPdf(data, options);
  return { ...parseLines(lines, options), lines };
}

function groupLines(items: TextItem[], pageHeight: number, page: number): TextLine[] {
  const pieces = items.map((i) => {
    const size = Math.hypot(i.transform[2] ?? 0, i.transform[3] ?? 0) || i.height || 10;
    return { text: i.str, x: i.transform[4] ?? 0, y: pageHeight - (i.transform[5] ?? 0), width: i.width, size };
  });
  pieces.sort((a, b) => a.y - b.y || a.x - b.x);

  const rows: { y: number; size: number; items: typeof pieces }[] = [];
  for (const piece of pieces) {
    const row = rows.find((r) => Math.abs(r.y - piece.y) <= Math.max(2, Math.min(r.size, piece.size) * 0.4));
    if (row) row.items.push(piece);
    else rows.push({ y: piece.y, size: piece.size, items: [piece] });
  }
  rows.sort((a, b) => a.y - b.y);

  return rows.map((r) => {
    r.items.sort((a, b) => a.x - b.x);
    const cells: TextCell[] = [];
    let cur: (TextCell & { size: number }) | undefined;
    for (const it of r.items) {
      const gap = cur ? it.x - (cur.x + cur.width) : Infinity;
      // Words in the same column are close together; columns are separated by wide gaps.
      if (cur && gap < it.size * 0.8) {
        const needsSpace = gap > it.size * 0.1 && !cur.text.endsWith(' ') && !it.text.startsWith(' ');
        cur.text += (needsSpace ? ' ' : '') + it.text;
        cur.width = it.x + it.width - cur.x;
      } else {
        cur = { text: it.text, x: it.x, width: it.width, size: it.size };
        cells.push(cur);
      }
    }
    return {
      page,
      y: Math.round(r.y * 100) / 100,
      cells: cells.map((c) => ({ text: c.text.trim(), x: c.x, width: c.width })).filter((c) => c.text),
    };
  });
}
