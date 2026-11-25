import type { ColumnRole, ParseResult, Template, Transaction } from './types.js';

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

export interface CsvOptions {
  /** "," (default) or ";" — Excel in many European locales expects ";". */
  delimiter?: ',' | ';' | '\t';
  /** Add a UTF-8 byte-order mark so Excel shows non-English text correctly. */
  bom?: boolean;
  /** Write amounts with a comma decimal (1234,56). Default: false. */
  decimalComma?: boolean;
}

export function toCSV(transactions: Transaction[], opts: CsvOptions = {}): string {
  const d = opts.delimiter ?? ',';
  const num = (n: number | undefined) => {
    if (n === undefined) return '';
    const s = n.toFixed(2);
    return opts.decimalComma ? s.replace('.', ',') : s;
  };
  const esc = (v: string) => (/[",;\t\n\r]/.test(v) || v !== v.trim() ? `"${v.replace(/"/g, '""')}"` : v);
  // Only add a "Statement" column when transactions come from more than one file.
  const withSource = new Set(transactions.map((t) => t.source ?? '')).size > 1;
  const header = ['Date', 'Description', 'Amount', 'Money Out', 'Money In', 'Balance', 'Category', 'Reference', 'Value Date'];
  if (withSource) header.push('Statement');
  const rows = transactions.map((t) => {
    const cells = [
      t.date,
      esc(t.description),
      num(t.amount),
      t.amount < 0 ? num(-t.amount) : '',
      t.amount > 0 ? num(t.amount) : '',
      num(t.balance),
      esc(t.category ?? ''),
      esc(t.reference ?? ''),
      t.valueDate ?? '',
    ];
    if (withSource) cells.push(esc(t.source ?? ''));
    return cells.join(d);
  });
  return (opts.bom ? '﻿' : '') + [header.join(d), ...rows].join('\r\n') + '\r\n';
}

// ---------------------------------------------------------------------------
// OFX 2 (imports into GnuCash, YNAB, Actual Budget, Firefly III, Quicken, MoneyMoney…)
// ---------------------------------------------------------------------------

export interface OfxOptions {
  currency?: string;
  accountId?: string;
  /** "CHECKING" (default), "SAVINGS", "CREDITLINE"… */
  accountType?: string;
}

export function toOFX(result: ParseResult, opts: OfxOptions = {}): string {
  const txs = result.transactions;
  const cur = (opts.currency ?? result.meta.currency ?? 'USD').toUpperCase();
  const d = (iso: string) => iso.replace(/-/g, '');
  const start = txs[0]?.date ?? '1970-01-01';
  const end = txs[txs.length - 1]?.date ?? start;
  const x = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const ledger = result.meta.closingBalance ?? [...txs].reverse().find((t) => t.balance !== undefined)?.balance;

  const body = txs
    .map(
      (t, i) => `<STMTTRN>
<TRNTYPE>${t.amount < 0 ? 'DEBIT' : 'CREDIT'}</TRNTYPE>
<DTPOSTED>${d(t.date)}</DTPOSTED>
<TRNAMT>${t.amount.toFixed(2)}</TRNAMT>
<FITID>${fitId(t, i)}</FITID>
<NAME>${x(t.description.slice(0, 32) || 'Transaction')}</NAME>
<MEMO>${x(t.description.slice(0, 255))}</MEMO>
</STMTTRN>`,
    )
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<?OFX OFXHEADER="200" VERSION="211" SECURITY="NONE" OLDFILEUID="NONE" NEWFILEUID="NONE"?>
<OFX>
<SIGNONMSGSRSV1><SONRS><STATUS><CODE>0</CODE><SEVERITY>INFO</SEVERITY></STATUS><DTSERVER>${d(end)}</DTSERVER><LANGUAGE>ENG</LANGUAGE></SONRS></SIGNONMSGSRSV1>
<BANKMSGSRSV1><STMTTRNRS><TRNUID>1</TRNUID><STATUS><CODE>0</CODE><SEVERITY>INFO</SEVERITY></STATUS>
<STMTRS>
<CURDEF>${x(cur)}</CURDEF>
<BANKACCTFROM><BANKID>0</BANKID><ACCTID>${x(opts.accountId ?? 'openstatement')}</ACCTID><ACCTTYPE>${opts.accountType ?? 'CHECKING'}</ACCTTYPE></BANKACCTFROM>
<BANKTRANLIST>
<DTSTART>${d(start)}</DTSTART>
<DTEND>${d(end)}</DTEND>
${body}
</BANKTRANLIST>
${ledger !== undefined ? `<LEDGERBAL><BALAMT>${ledger.toFixed(2)}</BALAMT><DTASOF>${d(end)}</DTASOF></LEDGERBAL>` : ''}
</STMTRS>
</STMTTRNRS></BANKMSGSRSV1>
</OFX>
`;
}

/** Stable id so re-importing the same statement does not create duplicates. */
function fitId(t: Transaction, index: number): string {
  const s = `${t.date}|${t.amount.toFixed(2)}|${t.description}|${index}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${t.date.replace(/-/g, '')}${h.toString(16).padStart(8, '0')}`;
}

// ---------------------------------------------------------------------------
// QIF
// ---------------------------------------------------------------------------

export function toQIF(transactions: Transaction[], opts: { dateFormat?: 'MDY' | 'DMY' | 'ISO' } = {}): string {
  const fmt = opts.dateFormat ?? 'MDY';
  const date = (iso: string) => {
    const [y, m, d] = iso.split('-');
    if (fmt === 'ISO') return iso;
    return fmt === 'MDY' ? `${m}/${d}/${y}` : `${d}/${m}/${y}`;
  };
  const lines = ['!Type:Bank'];
  for (const t of transactions) {
    lines.push(`D${date(t.date)}`, `T${t.amount.toFixed(2)}`, `P${t.description.replace(/\n/g, ' ')}`);
    if (t.category) lines.push(`L${t.category}`);
    if (t.reference) lines.push(`N${t.reference}`);
    lines.push('^');
  }
  return lines.join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// JSON
// ---------------------------------------------------------------------------

export function toJSON(result: ParseResult): string {
  const { transactions, meta } = result;
  return JSON.stringify(
    {
      generator: 'openstatement',
      currency: meta.currency,
      openingBalance: meta.openingBalance,
      closingBalance: meta.closingBalance,
      transactions,
    },
    null,
    2,
  );
}

// ---------------------------------------------------------------------------
// Template export: turn a (possibly user-corrected) parse into a shareable bank template.
// ---------------------------------------------------------------------------

export function templateFromResult(
  result: ParseResult,
  info: { id: string; name: string; country: string; detect?: string[] },
): Template {
  const { meta } = result;
  const template: Template = {
    id: info.id,
    name: info.name,
    country: info.country.toUpperCase(),
    ...(info.detect?.length ? { detect: { contains: info.detect } } : {}),
    dateOrder: meta.dateOrder,
    numberFormat: meta.numberFormat,
    ...(meta.currency ? { currency: meta.currency } : {}),
  };
  const labelled = meta.columns.filter((c) => c.label && c.role !== 'ignore');
  if (labelled.length >= 2 && meta.columns.every((c) => c.label)) {
    const headers: Partial<Record<ColumnRole, string[]>> = {};
    for (const c of labelled) (headers[c.role] ??= []).push(c.label!);
    template.headers = headers;
  } else {
    template.columns = meta.columns.map((c) => ({
      role: c.role,
      x0: Math.round(c.x0),
      x1: Math.round(c.x1),
      numeric: c.numeric,
    }));
  }
  return template;
}
