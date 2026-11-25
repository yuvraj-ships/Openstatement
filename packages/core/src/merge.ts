import type { Transaction } from './types.js';

export interface StatementInput {
  /** A name for the statement, e.g. its file name. Stored on each transaction as `source`. */
  name: string;
  transactions: Transaction[];
}

export interface MergeResult {
  /** All transactions, oldest first, with cross-statement duplicates removed. */
  transactions: Transaction[];
  /** How many rows were dropped because another statement already had them. */
  duplicatesRemoved: number;
}

/**
 * Combine several statements (e.g. 12 monthly PDFs) into one list.
 *
 * Statements downloaded for overlapping date ranges repeat some rows. A row is treated as a
 * duplicate only if a *different* statement has the same date, amount, balance and description.
 * Identical rows inside one statement (two coffees on the same day) are always kept: for each
 * distinct row we keep as many copies as the statement that has the most of them.
 */
export function mergeStatements(statements: StatementInput[]): MergeResult {
  // key -> per-statement occurrences
  const groups = new Map<string, { counts: Map<number, Transaction[]>; firstSeen: number }>();
  let order = 0;

  statements.forEach((s, si) => {
    for (const t of s.transactions) {
      const key = dedupeKey(t);
      let g = groups.get(key);
      if (!g) {
        g = { counts: new Map(), firstSeen: order };
        groups.set(key, g);
      }
      order++;
      const list = g.counts.get(si) ?? [];
      list.push({ ...t, source: t.source ?? s.name });
      g.counts.set(si, list);
    }
  });

  const kept: { t: Transaction; order: number }[] = [];
  let total = 0;
  for (const g of groups.values()) {
    let best: Transaction[] = [];
    for (const list of g.counts.values()) {
      total += list.length;
      if (list.length > best.length) best = list;
    }
    best.forEach((t, i) => kept.push({ t, order: g.firstSeen + i / 1000 }));
  }

  // Oldest first; rows on the same day keep their original statement order.
  kept.sort((a, b) => (a.t.date < b.t.date ? -1 : a.t.date > b.t.date ? 1 : a.order - b.order));
  return { transactions: kept.map((k) => k.t), duplicatesRemoved: total - kept.length };
}

function dedupeKey(t: Transaction): string {
  const desc = t.description.toLowerCase().replace(/\s+/g, ' ').trim();
  return `${t.date}|${t.amount.toFixed(2)}|${t.balance?.toFixed(2) ?? ''}|${desc}`;
}
