import type { DateOrder, NumberFormat } from './types.js';

/** Lower-case and strip accents, so "Févr." and "fevr." compare equal. */
export function normalize(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

// ---------------------------------------------------------------------------
// Months (English, German, French, Spanish, Italian, Portuguese, Dutch)
// ---------------------------------------------------------------------------

const MONTH_NAMES: string[][] = [
  ['january', 'januar', 'janvier', 'enero', 'gennaio', 'janeiro', 'januari', 'jan', 'janv', 'ene', 'gen'],
  ['february', 'februar', 'fevrier', 'febrero', 'febbraio', 'fevereiro', 'februari', 'feb', 'fev', 'fevr', 'febb'],
  ['march', 'marz', 'maerz', 'mars', 'marzo', 'marco', 'maart', 'mar', 'mrz', 'mrt'],
  ['april', 'avril', 'abril', 'aprile', 'apr', 'avr', 'abr'],
  ['may', 'mai', 'mayo', 'maggio', 'maio', 'mei', 'mag'],
  ['june', 'juni', 'juin', 'junio', 'giugno', 'junho', 'jun', 'giu'],
  ['july', 'juli', 'juillet', 'julio', 'luglio', 'julho', 'jul', 'juil', 'lug'],
  ['august', 'aout', 'agosto', 'augustus', 'aug', 'ago'],
  ['september', 'septembre', 'septiembre', 'settembre', 'setembro', 'sep', 'sept', 'set'],
  ['october', 'oktober', 'octobre', 'octubre', 'ottobre', 'outubro', 'oct', 'okt', 'ott', 'out'],
  ['november', 'novembre', 'noviembre', 'novembro', 'nov'],
  ['december', 'dezember', 'decembre', 'diciembre', 'dicembre', 'dezembro', 'dec', 'dez', 'dic'],
];

/** Returns 1–12 for a month name or abbreviation in a supported language, else undefined. */
export function monthFromName(word: string): number | undefined {
  const w = normalize(word).replace(/\.$/, '');
  if (w.length < 3) return undefined;
  for (let i = 0; i < MONTH_NAMES.length; i++) {
    const names = MONTH_NAMES[i]!;
    if (names.includes(w)) return i + 1;
  }
  // Accept other abbreviations of a full name, e.g. "sept" or "janu".
  for (let i = 0; i < MONTH_NAMES.length; i++) {
    const names = MONTH_NAMES[i]!;
    if (w.length >= 4 && names.some((n) => n.length > w.length && n.startsWith(w))) return i + 1;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

/** A date as written on the statement, before we know the day/month order or the year. */
export interface RawDate {
  /** Numeric parts in the order they appear (for numeric dates). */
  parts?: [number, number, number | undefined];
  /** Set when the month was written as a word, so the order is unambiguous. */
  day?: number;
  month?: number;
  year?: number;
  /** True for YYYY-MM-DD style. */
  yearFirst?: boolean;
}

const NUMERIC_DATE = /^(\d{1,4})([./-])(\d{1,2})\2(\d{2,4})$/;
const NUMERIC_DATE_NO_YEAR = /^(\d{1,2})(?:\.(\d{1,2})\.|\/(\d{1,2}))$/;
const DAY_MONTH_NAME = /^(\d{1,2})(?:st|nd|rd|th)?[\s\-./]*([A-Za-zÀ-ſ]{3,10})\.?(?:[\s\-./,]*(\d{4}|\d{2}))?$/;
const MONTH_NAME_DAY = /^([A-Za-zÀ-ſ]{3,10})\.?[\s\-./]*(\d{1,2})(?:st|nd|rd|th)?(?:,?[\s\-./]*(\d{4}))?$/;

function fullYear(y: number | undefined): number | undefined {
  if (y === undefined) return undefined;
  if (y < 100) return y >= 70 ? 1900 + y : 2000 + y;
  return y;
}

/** Recognise a date token. Returns undefined if the text is not a date. */
export function readDate(text: string): RawDate | undefined {
  const t = text.trim();
  if (t.length < 3 || t.length > 20) return undefined;

  let m = NUMERIC_DATE.exec(t);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[3]);
    const c = Number(m[4]);
    if (m[1]!.length === 4) {
      if (b < 1 || b > 12 || c < 1 || c > 31) return undefined;
      return { parts: [a, b, c], yearFirst: true };
    }
    if (m[1]!.length > 2 || m[4]!.length === 3) return undefined;
    if (a < 1 || b < 1 || a > 31 || b > 31 || (a > 12 && b > 12)) return undefined;
    return { parts: [a, b, fullYear(c)] };
  }

  m = NUMERIC_DATE_NO_YEAR.exec(t);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2] ?? m[3]);
    if (a < 1 || b < 1 || a > 31 || b > 31 || (a > 12 && b > 12)) return undefined;
    return { parts: [a, b, undefined] };
  }

  m = DAY_MONTH_NAME.exec(t);
  if (m) {
    const month = monthFromName(m[2]!);
    const day = Number(m[1]);
    if (month && day >= 1 && day <= 31) return { day, month, year: fullYear(m[3] ? Number(m[3]) : undefined) };
  }

  m = MONTH_NAME_DAY.exec(t);
  if (m) {
    const month = monthFromName(m[1]!);
    const day = Number(m[2]);
    if (month && day >= 1 && day <= 31) return { day, month, year: m[3] ? Number(m[3]) : undefined };
  }
  return undefined;
}

export function isDate(text: string): boolean {
  return readDate(text) !== undefined;
}

export interface YMD {
  year?: number;
  month: number;
  day: number;
}

/** Resolve a raw date with a given day/month order. Returns undefined if invalid in that order. */
export function resolveDate(raw: RawDate, order: DateOrder): YMD | undefined {
  if (raw.month !== undefined && raw.day !== undefined) {
    return { year: raw.year, month: raw.month, day: raw.day };
  }
  if (!raw.parts) return undefined;
  const [a, b, c] = raw.parts;
  let ymd: YMD;
  if (raw.yearFirst) ymd = { year: a, month: b, day: c! };
  else if (order === 'MDY') ymd = { year: c, month: a, day: b };
  else ymd = { year: c, month: b, day: a }; // DMY (and YMD falls back to DMY for 2-digit-first dates)
  if (ymd.month < 1 || ymd.month > 12 || ymd.day < 1 || ymd.day > daysInMonth(ymd.month, ymd.year ?? 2000)) {
    return undefined;
  }
  return ymd;
}

function daysInMonth(month: number, year: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Work out whether numeric dates are DMY or MDY.
 * Uses impossible values first (a "25" can only be a day), then falls back to
 * whichever order keeps the dates closest to chronological order.
 */
export function detectDateOrder(raws: RawDate[]): DateOrder {
  const numeric = raws.filter((r) => r.parts);
  if (numeric.length === 0) return 'DMY';
  if (numeric.every((r) => r.yearFirst)) return 'YMD';

  let dmy = 0;
  let mdy = 0;
  for (const r of numeric) {
    if (r.yearFirst) continue;
    const [a, b] = r.parts!;
    if (a > 12 && b <= 12) dmy++;
    if (b > 12 && a <= 12) mdy++;
  }
  if (dmy !== mdy) return dmy > mdy ? 'DMY' : 'MDY';

  // All ambiguous (every day <= 12): prefer the order that reads most chronologically.
  const disorder = (order: DateOrder) => {
    const keys = numeric
      .map((r) => resolveDate(r, order))
      .map((d) => (d ? (d.year ?? 0) * 10000 + d.month * 100 + d.day : NaN));
    let jumps = 0;
    for (let i = 1; i < keys.length; i++) {
      const prev = keys[i - 1]!;
      const cur = keys[i]!;
      if (Number.isNaN(prev) || Number.isNaN(cur)) jumps += 2;
      else if (cur !== prev) jumps += Math.abs(cur - prev) > 40 ? 1 : 0;
    }
    return jumps;
  };
  return disorder('MDY') < disorder('DMY') ? 'MDY' : 'DMY';
}

export function toIso(d: { year: number; month: number; day: number }): string {
  return `${String(d.year).padStart(4, '0')}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Amounts
// ---------------------------------------------------------------------------

const CURRENCY_CODES =
  'USD|EUR|GBP|INR|JPY|CNY|RMB|AUD|CAD|CHF|SEK|NOK|DKK|PLN|CZK|HUF|RON|BGN|TRY|RUB|UAH|ZAR|NGN|KES|GHS|EGP|MAD|AED|SAR|QAR|KWD|BHD|OMR|ILS|PKR|BDT|LKR|NPR|IDR|MYR|SGD|THB|VND|PHP|KRW|HKD|TWD|NZD|MXN|BRL|ARS|CLP|COP|PEN';
const CURRENCY_SYMBOLS = '$€£¥₹₩₺₽₪₫฿₱₦₴';
const CUR = `(?:(?:${CURRENCY_CODES})\\s?|[${CURRENCY_SYMBOLS}]\\s?|(?:Rs\\.?|R\\$|US\\$|A\\$|C\\$|S\\$)\\s?)`;
const CUR_SUFFIX = `(?:\\s?(?:${CURRENCY_CODES}|[${CURRENCY_SYMBOLS}]))`;
const SIGN_SUFFIX = `(?:\\s?(?:-|−|\\+|CR|DR|Cr|Dr|cr|dr|C|D))`;
// 1,234,567 / 1.234.567 / 1 234 567 / 1'234'567 — and the Indian lakh style 12,34,567.
const GROUPED = `(?:\\d{1,2}(?:,\\d{2})+,\\d{3}|\\d{1,3}(?:[,.'’\\u00a0\\u202f ]\\d{3})+)`;

function amountPattern(requireDecimals: boolean): string {
  const decimals = requireDecimals ? `[.,]\\d{2}` : `(?:[.,]\\d{1,2})?`;
  const integer = requireDecimals ? `(?:${GROUPED}|\\d+)` : `(?:${GROUPED}|\\d{1,9})`;
  return `[-−+]?\\(?\\s?${CUR}?[-−]?${integer}${decimals}\\)?${CUR_SUFFIX}?${SIGN_SUFFIX}?`;
}

const STRICT_AMOUNT = new RegExp(`^${amountPattern(true)}$`);
const LOOSE_AMOUNT = new RegExp(`^${amountPattern(false)}$`);
const STRICT_AMOUNT_AT_END = new RegExp(`(?:^|\\s)(${amountPattern(true)})$`);
const LOOSE_AMOUNT_AT_END = new RegExp(`(?:^|\\s)(${amountPattern(false)})$`);

/**
 * Is this text a money amount?
 * In strict mode (the default) the amount must have 2 decimals, which avoids mistaking
 * reference numbers for money. Loose mode is used for currencies without decimals (JPY, KRW…).
 */
export function isAmount(text: string, strict = true): boolean {
  const t = text.trim();
  if (!/\d/.test(t)) return false;
  if (!strict && /^\d{5,}$/.test(t)) return false; // long bare numbers are references, not money
  return (strict ? STRICT_AMOUNT : LOOSE_AMOUNT).test(t);
}

/** If the text ends with an amount (e.g. "Coffee shop 4.50"), returns the amount part. */
export function trailingAmount(text: string, strict = true): string | undefined {
  const m = (strict ? STRICT_AMOUNT_AT_END : LOOSE_AMOUNT_AT_END).exec(text.trim());
  return m ? m[1] : undefined;
}

export interface ParsedAmount {
  value: number;
  /** -1 if the text itself says "money out" (minus, brackets, DR), +1 if it says "money in" (CR, +), else 0. */
  sign: -1 | 0 | 1;
}

const CUR_SUFFIX_AT_END = new RegExp(`${CUR_SUFFIX}$`);

/**
 * Parse an amount token into a number and an explicit sign, if the text carries one.
 * A separator followed by 1–2 digits is the decimal point; a separator followed by exactly
 * 3 digits is a thousands group ("1.234" = 1234), which is how statements are written worldwide.
 */
export function parseAmount(text: string): ParsedAmount | undefined {
  let t = text.trim();
  if (!/\d/.test(t)) return undefined;

  const core = t.replace(CUR_SUFFIX_AT_END, '').trim();
  let sign: -1 | 0 | 1 = 0;
  if (/^[^\d]*[-−]/.test(core) || /^\(.*\)$/.test(core) || /[-−]$/.test(core) || /\d\s?(DR|Dr|dr|D)$/.test(core)) {
    sign = -1;
  } else if (/^\+|\+$/.test(core) || /\d\s?(CR|Cr|cr|C)$/.test(core)) {
    sign = 1;
  }

  t = core.replace(/\s?(DR|Dr|dr|CR|Cr|cr|C|D)$/, '').replace(/[^\d.,]/g, '');
  if (!t) return undefined;

  const lastSep = Math.max(t.lastIndexOf('.'), t.lastIndexOf(','));
  let intPart = t;
  let fracPart = '';
  if (lastSep >= 0) {
    const tail = t.slice(lastSep + 1);
    if (tail.length > 0 && tail.length <= 2) {
      intPart = t.slice(0, lastSep);
      fracPart = tail;
    }
  }
  intPart = intPart.replace(/[.,]/g, '');
  const value = Number(`${intPart || '0'}.${fracPart || '0'}`);
  if (!Number.isFinite(value)) return undefined;
  return { value, sign };
}

/** Guess the decimal separator from a set of amount tokens. */
export function detectNumberFormat(tokens: string[]): NumberFormat {
  let dot = 0;
  let comma = 0;
  for (const tok of tokens) {
    const m = /([.,])\d{2}(?!\d)[^\d]*$/.exec(tok.trim());
    if (m) {
      if (m[1] === '.') dot++;
      else comma++;
    }
  }
  return { decimal: comma > dot ? ',' : '.' };
}

// ---------------------------------------------------------------------------
// Currency
// ---------------------------------------------------------------------------

const SYMBOL_TO_CODE: Record<string, string> = {
  '€': 'EUR',
  '£': 'GBP',
  '₹': 'INR',
  '¥': 'JPY',
  '₩': 'KRW',
  '₺': 'TRY',
  '₽': 'RUB',
  '₪': 'ILS',
  '₫': 'VND',
  '฿': 'THB',
  '₱': 'PHP',
  '₦': 'NGN',
  '₴': 'UAH',
  'R$': 'BRL',
  'Rs': 'INR',
};

/** Guess the statement currency from its full text (most frequent code or symbol). */
export function detectCurrency(text: string): string | undefined {
  const counts = new Map<string, number>();
  const bump = (c: string, n = 1) => counts.set(c, (counts.get(c) ?? 0) + n);
  for (const m of text.matchAll(new RegExp(`\\b(${CURRENCY_CODES})\\b`, 'g'))) bump(m[1]!, 2);
  for (const m of text.matchAll(/R\$|Rs\.?(?=\s?\d)|[€£₹¥₩₺₽₪₫฿₱₦₴]/g)) {
    const key = m[0].startsWith('Rs') ? 'Rs' : m[0];
    const code = SYMBOL_TO_CODE[key];
    if (code) bump(code);
  }
  let best: string | undefined;
  let bestN = 0;
  for (const [c, n] of counts) {
    if (n > bestN) {
      best = c;
      bestN = n;
    }
  }
  if (best === 'RMB') best = 'CNY';
  if (!best && /\$\s?\d/.test(text)) best = 'USD';
  return best;
}
