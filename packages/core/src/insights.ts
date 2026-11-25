import type { Transaction } from './types.js';

export interface MonthSummary {
  /** YYYY-MM */
  month: string;
  moneyIn: number;
  moneyOut: number;
  net: number;
  count: number;
}

export interface RecurringPayment {
  /** A readable name, taken from the most recent matching transaction. */
  name: string;
  /** Typical (median) amount, as a positive number. */
  amount: number;
  /** Number of different months it was charged in. */
  months: number;
  /** Estimated cost per year (amount × 12). */
  perYear: number;
  lastDate: string;
  category?: string;
}

export interface CategoryChange {
  category: string;
  month: string;
  previousMonth: string;
  current: number;
  previous: number;
  /** Percentage change, e.g. 18 for +18%. */
  change: number;
}

export interface Insights {
  months: MonthSummary[];
  totals: { moneyIn: number; moneyOut: number; net: number };
  /** Average money out per month (over the months that have any transactions). */
  averageMonthlySpend: number;
  biggestExpense?: Transaction;
  biggestIncome?: Transaction;
  topCategory?: { category: string; amount: number; share: number };
  /** How the latest month's top spending category compares with the month before. */
  categoryChange?: CategoryChange;
  /** Payments that repeat every month at about the same amount (subscriptions, rent, EMIs…). */
  recurring: RecurringPayment[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Summaries that are easy to show to people: per-month totals, top category, subscriptions. */
export function getInsights(transactions: Transaction[]): Insights {
  const byMonth = new Map<string, MonthSummary>();
  let moneyIn = 0;
  let moneyOut = 0;
  for (const t of transactions) {
    const month = t.date.slice(0, 7);
    let m = byMonth.get(month);
    if (!m) {
      m = { month, moneyIn: 0, moneyOut: 0, net: 0, count: 0 };
      byMonth.set(month, m);
    }
    if (t.amount >= 0) {
      m.moneyIn += t.amount;
      moneyIn += t.amount;
    } else {
      m.moneyOut -= t.amount;
      moneyOut -= t.amount;
    }
    m.count++;
  }
  const months = [...byMonth.values()]
    .sort((a, b) => a.month.localeCompare(b.month))
    .map((m) => ({ ...m, moneyIn: round2(m.moneyIn), moneyOut: round2(m.moneyOut), net: round2(m.moneyIn - m.moneyOut) }));

  const outs = transactions.filter((t) => t.amount < 0);
  const ins = transactions.filter((t) => t.amount > 0);
  const biggestExpense = outs.reduce<Transaction | undefined>((b, t) => (!b || t.amount < b.amount ? t : b), undefined);
  const biggestIncome = ins.reduce<Transaction | undefined>((b, t) => (!b || t.amount > b.amount ? t : b), undefined);

  const catTotals = totalsByCategory(outs);
  const top = [...catTotals].sort((a, b) => b[1] - a[1])[0];

  return {
    months,
    totals: { moneyIn: round2(moneyIn), moneyOut: round2(moneyOut), net: round2(moneyIn - moneyOut) },
    averageMonthlySpend: months.length ? round2(moneyOut / months.length) : 0,
    ...(biggestExpense ? { biggestExpense } : {}),
    ...(biggestIncome ? { biggestIncome } : {}),
    ...(top && moneyOut > 0 ? { topCategory: { category: top[0], amount: round2(top[1]), share: round2((top[1] / moneyOut) * 100) } } : {}),
    ...categoryChangeOf(outs, months),
    recurring: findRecurring(outs),
  };
}

function totalsByCategory(txs: Transaction[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const t of txs) totals.set(t.category ?? 'Other', (totals.get(t.category ?? 'Other') ?? 0) + Math.abs(t.amount));
  return totals;
}

function categoryChangeOf(outs: Transaction[], months: MonthSummary[]): { categoryChange?: CategoryChange } {
  if (months.length < 2) return {};
  const month = months[months.length - 1]!.month;
  const previousMonth = months[months.length - 2]!.month;
  const cur = totalsByCategory(outs.filter((t) => t.date.startsWith(month)));
  const prev = totalsByCategory(outs.filter((t) => t.date.startsWith(previousMonth)));
  const top = [...cur].sort((a, b) => b[1] - a[1])[0];
  if (!top) return {};
  const previous = prev.get(top[0]) ?? 0;
  if (previous <= 0) return {};
  return {
    categoryChange: {
      category: top[0],
      month,
      previousMonth,
      current: round2(top[1]),
      previous: round2(previous),
      change: Math.round(((top[1] - previous) / previous) * 100),
    },
  };
}

/** "UPI/NETFLIX.COM/0001234/Monthly" → "upi netflix com monthly" */
export function merchantKey(description: string): string {
  return description
    .toLowerCase()
    .replace(/\d{3,}/g, ' ')
    .replace(/[^a-zÀ-ɏ]+/g, ' ')
    .trim()
    .split(' ')
    .filter((w) => w.length > 1)
    .slice(0, 3)
    .join(' ');
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/**
 * Recurring = same merchant, roughly the same amount (±10%), charged in at least two different
 * months, about a month apart. Variable spending at one shop (groceries, food delivery) has
 * varying amounts and is left out.
 */
function findRecurring(outs: Transaction[]): RecurringPayment[] {
  const byMerchant = new Map<string, Transaction[]>();
  for (const t of outs) {
    const key = merchantKey(t.description);
    if (!key) continue;
    const list = byMerchant.get(key) ?? [];
    list.push(t);
    byMerchant.set(key, list);
  }

  const found: RecurringPayment[] = [];
  for (const list of byMerchant.values()) {
    // Split each merchant's payments into clusters of similar amounts.
    const sorted = [...list].sort((a, b) => a.amount - b.amount);
    const clusters: Transaction[][] = [];
    for (const t of sorted) {
      const cl = clusters[clusters.length - 1];
      const ref = cl ? Math.abs(median(cl.map((x) => x.amount))) : 0;
      if (cl && Math.abs(Math.abs(t.amount) - ref) <= Math.max(1, ref * 0.1)) cl.push(t);
      else clusters.push([t]);
    }
    for (const cl of clusters) {
      const byDate = [...cl].sort((a, b) => a.date.localeCompare(b.date));
      const monthsSeen = new Set(byDate.map((t) => t.date.slice(0, 7)));
      if (monthsSeen.size < 2 || monthsSeen.size !== byDate.length) continue;
      const gaps = byDate.slice(1).map((t, i) => daysBetween(byDate[i]!.date, t.date));
      if (!gaps.every((g) => g >= 20 && g <= 40)) continue;
      const last = byDate[byDate.length - 1]!;
      const amount = round2(Math.abs(median(byDate.map((t) => t.amount))));
      found.push({
        name: last.description.replace(/\s+/g, ' ').trim(),
        amount,
        months: monthsSeen.size,
        perYear: round2(amount * 12),
        lastDate: last.date,
        ...(last.category ? { category: last.category } : {}),
      });
    }
  }
  return found.sort((a, b) => b.perYear - a.perYear);
}
