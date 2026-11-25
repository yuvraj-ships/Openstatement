import type {
  Column,
  ColumnRole,
  DateOrder,
  ParseOptions,
  ParseResult,
  Template,
  TextCell,
  TextLine,
  Transaction,
} from './types.js';
import {
  type RawDate,
  detectCurrency,
  detectDateOrder,
  detectNumberFormat,
  isAmount,
  isDate,
  parseAmount,
  readDate,
  resolveDate,
  toIso,
  trailingAmount,
} from './tokens.js';
import { NUMERIC_ROLES, roleForHeader } from './headers.js';
import { findTemplate, matchTemplate } from './templates/index.js';
import { categorize } from './categorize.js';

// ---------------------------------------------------------------------------
// Internal structures
// ---------------------------------------------------------------------------

type Kind = 'date' | 'amount' | 'text';

interface Cell {
  text: string;
  x0: number;
  x1: number;
  kind: Kind;
  date?: RawDate;
  /** Position estimated by splitting a longer text run (less reliable for column matching). */
  estimated?: boolean;
}

interface Line {
  page: number;
  y: number;
  cells: Cell[];
  text: string;
}

interface Row {
  page: number;
  y: number;
  date?: RawDate;
  valueDate?: RawDate;
  description: string[];
  reference: string[];
  debit?: number;
  credit?: number;
  amount?: number;
  balance?: number;
  /** Sign written on the statement itself (minus, brackets, DR/CR). */
  sign: -1 | 0 | 1;
  /** Sign implied by the section the row is in ("Withdrawals", "Deposits"…). */
  sectionSign: -1 | 0 | 1;
}

const OPENING =
  /(opening|beginning|starting|previous|start)\s+balance|balance\s+(brought|b\/?f)|brought\s+forward|\bb\/f\b|anfangssaldo|alter\s+kontostand|saldo\s+(inicial|anterior|iniziale|precedente|vorher)|solde\s+(initial|pr[eé]c[eé]dent|d[eé]but|ancien)|ancien\s+solde|beginsaldo/i;
const CLOSING =
  /(closing|ending|final|new)\s+balance|balance\s+(carried|c\/?f)|carried\s+forward|\bc\/f\b|endsaldo|neuer\s+kontostand|saldo\s+(final|finale|actual|attuale)|solde\s+(final|nouveau)|nouveau\s+solde|eindsaldo/i;
const DEFAULT_SKIP = [
  /\bpage\s+\d+\s*(of|\/)\s*\d+/i,
  /^\s*(seite|page|pagina|página)\s+\d+/i,
  /^\s*(sub\s*)?totals?\b/i,
  /^\s*(summe|gesamt|total\s+general)\b/i,
];
const SECTION_IN = /^\s*(deposits?|credits?|additions|money\s+in|paid\s+in|incoming|gutschriften|einnahmen)\b/i;
const SECTION_OUT =
  /^\s*(withdrawals?|debits?|payments?|checks?(\s+paid)?|cheques?|purchases|card\s+purchases|subtractions|fees|money\s+out|paid\s+out|outgoing|lastschriften|ausgaben)\b/i;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Turn the text lines of a statement into transactions.
 * Works for any bank: it finds the transaction table, figures out the date and number formats,
 * maps columns, and uses running balances to double-check money in vs money out.
 */
export function parseLines(input: TextLine[], options: ParseOptions = {}): ParseResult {
  const warnings: string[] = [];
  const fullText = input.map((l) => l.cells.map((c) => c.text).join(' ')).join('\n');

  const template = resolveTemplate(options.template, fullText);
  const skip = [...DEFAULT_SKIP, ...(template?.skip ?? []).map((s) => new RegExp(s, 'i'))];

  // 1. Tokenise cells. Try strict amounts (2 decimals) first, then loose for currencies like JPY.
  let lines = prepare(input, true);
  if (countCandidates(lines) < 2) {
    const loose = prepare(input, false);
    if (countCandidates(loose) > countCandidates(lines)) lines = loose;
  }
  const isCandidate = (l: Line) => candidateDateIndex(l) >= 0;
  const candidates = lines.filter(isCandidate);

  if (input.length === 0 || fullText.trim().length === 0) {
    warnings.push('No text found. This PDF may be a scanned image — OCR is not supported yet.');
  } else if (candidates.length === 0) {
    warnings.push('No transaction rows found. Try picking columns manually or a different date format.');
  }

  // 2. Date and number formats.
  const dateOrder: DateOrder =
    options.dateOrder ?? template?.dateOrder ?? detectDateOrder(candidates.map((l) => l.cells[candidateDateIndex(l)]!.date!));
  const amountTokens = lines.flatMap((l) => l.cells.filter((c) => c.kind === 'amount').map((c) => c.text));
  const numberFormat = options.numberFormat ?? template?.numberFormat ?? detectNumberFormat(amountTokens);
  const currency = options.currency ?? template?.currency ?? detectCurrency(fullText);

  // 3. Columns.
  const headerLines = findHeaders(lines, template, isCandidate);
  let columnsForPage: (page: number) => Column[];
  let columns: Column[];
  if (options.columns?.length) {
    columns = options.columns;
    columnsForPage = () => columns;
  } else if (template?.columns?.length) {
    columns = template.columns.map((c, index) => ({
      index,
      role: c.role,
      x0: c.x0,
      x1: c.x1,
      numeric: c.numeric ?? NUMERIC_ROLES.has(c.role),
      source: 'template' as const,
    }));
    columnsForPage = () => columns;
  } else if (headerLines.size > 0) {
    const pages = [...headerLines.keys()].sort((a, b) => a - b);
    columns = headerLines.get(pages[0]!)!;
    columnsForPage = (page) => {
      let best = columns;
      for (const p of pages) if (p <= page) best = headerLines.get(p)!;
      return best;
    };
  } else {
    columns = inferColumns(candidates);
    columnsForPage = () => columns;
  }

  // 4. Walk the lines and build rows.
  const rows: Row[] = [];
  let openingBalance: number | undefined;
  let closingBalance: number | undefined;
  let sectionSign: -1 | 0 | 1 = 0;
  let last: { row: Row; page: number; y: number } | undefined;
  const lineGap = typicalLineGap(lines);
  const headerSet = new Set<Line>();
  for (const l of lines) if (isHeaderLine(l, template)) headerSet.add(l);

  for (const line of lines) {
    if (headerSet.has(line)) {
      last = undefined;
      continue;
    }
    if (skip.some((re) => re.test(line.text))) continue;

    if (OPENING.test(line.text)) {
      const amt = lastAmount(line);
      if (amt !== undefined && openingBalance === undefined) openingBalance = amt;
      last = undefined;
      continue;
    }
    if (CLOSING.test(line.text)) {
      const amt = lastAmount(line);
      if (amt !== undefined) closingBalance = amt;
      last = undefined;
      continue;
    }

    const cols = columnsForPage(line.page);
    if (isCandidate(line)) {
      const row = buildRow(line, cols, sectionSign);
      if (row && hasMoney(row)) {
        rows.push(row);
        last = { row, page: line.page, y: line.y };
      }
      continue;
    }

    // Not a dated row. It may be (a) a section title, (b) a row that shares the previous date,
    // or (c) the next line of a long description.
    if (line.cells.every((c) => c.kind === 'text')) {
      if (SECTION_IN.test(line.text)) sectionSign = 1;
      else if (SECTION_OUT.test(line.text)) sectionSign = -1;
    }
    if (!last || last.page !== line.page || line.y - last.y > lineGap * 2.2) {
      last = undefined;
      continue;
    }
    const undated = buildRow(line, cols, sectionSign, last.row.date);
    if (undated && hasMoney(undated) && line.cells.some((c) => c.kind === 'text')) {
      rows.push(undated);
      last = { row: undated, page: line.page, y: line.y };
    } else if (line.cells.every((c) => c.kind !== 'amount')) {
      const text = line.cells
        .filter((c) => c.kind === 'text')
        .map((c) => c.text)
        .join(' ');
      if (text) last.row.description.push(text);
      last.y = line.y;
    }
  }

  // 5. Dates → ISO, filling in missing years.
  const year = guessYear(rows, fullText);
  const dated = rows
    .map((r) => ({ r, d: r.date ? resolveDate(r.date, dateOrder) : undefined }))
    .filter((x): x is { r: Row; d: NonNullable<typeof x.d> } => x.d !== undefined);
  if (dated.length < rows.length) warnings.push(`${rows.length - dated.length} row(s) had an unreadable date and were skipped.`);
  const months = new Set(dated.filter((x) => x.d.year === undefined).map((x) => x.d.month));
  const wrapsYear = [...months].some((m) => m >= 10) && [...months].some((m) => m <= 3);

  let txs = dated.map(({ r, d }) => {
    const y = d.year ?? (wrapsYear && d.month >= 7 ? year - 1 : year);
    const vd = r.valueDate ? resolveDate(r.valueDate, dateOrder) : undefined;
    return {
      row: r,
      date: toIso({ year: y, month: d.month, day: d.day }),
      valueDate: vd ? toIso({ year: vd.year ?? y, month: vd.month, day: vd.day }) : undefined,
    };
  });

  // 6. Newest-first statements are flipped to oldest-first.
  if (txs.length > 1 && txs[0]!.date > txs[txs.length - 1]!.date) txs = txs.reverse();

  // 7. Amounts and signs, verified against the running balance.
  const hasDebitCredit = columns.some((c) => c.role === 'debit' || c.role === 'credit');
  let prevBalance = openingBalance;
  let checked = 0;
  let matched = 0;
  let unknownSign = 0;
  const transactions: Transaction[] = [];

  for (const { row, date, valueDate } of txs) {
    let amount: number;
    let signKnown = true;
    if (row.debit !== undefined || row.credit !== undefined) {
      amount = Math.abs(row.credit ?? 0) - Math.abs(row.debit ?? 0);
    } else {
      const v = Math.abs(row.amount ?? 0);
      const sign = row.sign || (hasDebitCredit ? 0 : row.sectionSign);
      amount = sign === 0 ? v : v * sign;
      signKnown = sign !== 0;
    }

    if (row.balance !== undefined && prevBalance !== undefined) {
      const diff = round2(row.balance - prevBalance);
      checked++;
      if (near(diff, amount)) {
        matched++;
        signKnown = true;
      } else if (near(diff, -amount)) {
        // Columns were swapped, or the amount was unsigned: the balance tells us the truth.
        amount = -amount;
        matched++;
        signKnown = true;
      }
    }
    if (!signKnown) unknownSign++;

    if (row.balance !== undefined) prevBalance = row.balance;
    else if (prevBalance !== undefined) prevBalance = round2(prevBalance + amount);

    const description = row.description.join(' ').replace(/\s+/g, ' ').trim();
    transactions.push({
      date,
      ...(valueDate && valueDate !== date ? { valueDate } : {}),
      description,
      amount: round2(amount),
      ...(row.balance !== undefined ? { balance: row.balance } : {}),
      ...(row.reference.length ? { reference: row.reference.join(' ') } : {}),
      page: row.page,
    });
  }

  if (options.categorize !== false) {
    for (const t of transactions) t.category = categorize(t.description, t.amount);
  }

  // 8. Confidence and warnings.
  if (checked > 0 && matched < checked) {
    warnings.push(`${checked - matched} of ${checked} running balances did not add up. Please review those rows.`);
  }
  if (unknownSign > 0) {
    warnings.push(
      `${unknownSign} transaction(s) have no money in/out marker. They are shown as money in — check the column mapping.`,
    );
  }
  if (closingBalance !== undefined && prevBalance !== undefined && !near(closingBalance, prevBalance) && checked > 0) {
    warnings.push('The closing balance does not match the last running balance. Some rows may be missing.');
  }

  let confidence: number;
  if (transactions.length === 0) confidence = 0;
  else if (checked > 0) confidence = matched / checked;
  else if (hasDebitCredit) confidence = 0.8;
  else confidence = 0.75 * (1 - unknownSign / transactions.length);
  if (unknownSign > 0) confidence = Math.min(confidence, 1 - unknownSign / transactions.length);

  return {
    transactions,
    meta: {
      dateOrder,
      numberFormat,
      ...(currency ? { currency } : {}),
      ...(template ? { template: template.id } : {}),
      columns,
      ...(openingBalance !== undefined ? { openingBalance } : {}),
      ...(closingBalance !== undefined ? { closingBalance } : {}),
      balanceCheck: { checked, matched },
      confidence: Math.round(confidence * 100) / 100,
      warnings,
    },
  };

}

function lastAmount(line: Line): number | undefined {
  const amounts = line.cells.filter((c) => c.kind === 'amount');
  const tok = amounts[amounts.length - 1];
  if (!tok) return undefined;
  const p = parseAmount(tok.text);
  return p ? p.value * (p.sign === -1 ? -1 : 1) : undefined;
}

// ---------------------------------------------------------------------------
// Tokenising
// ---------------------------------------------------------------------------

function classify(text: string, strict: boolean): Kind {
  if (isDate(text)) return 'date';
  if (isAmount(text, strict)) {
    if (!strict && !/[.,'’   ]/.test(text) && text.replace(/\D/g, '').length > 6) return 'text';
    return 'amount';
  }
  return 'text';
}

/**
 * Split a text run into date / text / amount pieces. Some PDFs put a whole row in one run,
 * e.g. "03/01/2026 Coffee Shop 4.50 1,204.10".
 */
function splitCell(c: TextCell, strict: boolean): Cell[] {
  const text = c.text.replace(/\s+/g, ' ').trim();
  if (!text) return [];
  const charW = c.width / Math.max(c.text.length, 1);
  const mk = (t: string, from: number, kind: Kind): Cell => {
    const cell: Cell = { text: t, x0: c.x + from * charW, x1: c.x + (from + t.length) * charW, kind };
    if (kind === 'date') cell.date = readDate(t);
    return cell;
  };

  const whole = classify(text, strict);
  if (whole !== 'text') return [mk(text, 0, whole)];

  const out: Cell[] = [];
  const done = () => {
    const all = [...out, ...tail];
    if (all.length > 1) for (const cell of all) cell.estimated = true;
    return all;
  };
  let start = 0;
  const words = text.split(' ');
  for (let n = Math.min(4, words.length - 1); n >= 1; n--) {
    const prefix = words.slice(0, n).join(' ');
    if (isDate(prefix)) {
      out.push(mk(prefix, 0, 'date'));
      start = prefix.length + 1;
      break;
    }
  }

  let rest = text.slice(start);
  const tail: Cell[] = [];
  for (let k = 0; k < 3; k++) {
    const amt = trailingAmount(rest, strict);
    if (!amt || amt.length >= rest.length) break;
    if (!strict && !/[.,]/.test(amt)) break;
    const at = rest.length - amt.length;
    tail.unshift(mk(amt, start + at, 'amount'));
    rest = rest.slice(0, at).trimEnd();
  }
  if (rest.trim()) {
    const kind = classify(rest.trim(), strict);
    out.push(mk(rest.trim(), start, kind));
  }
  return done();
}

function prepare(input: TextLine[], strict: boolean): Line[] {
  return input.map((l) => {
    const cells = [...l.cells].sort((a, b) => a.x - b.x).flatMap((c) => splitCell(c, strict));
    return { page: l.page, y: l.y, cells, text: cells.map((c) => c.text).join(' ') };
  });
}

/** Index of the row's date cell if this line looks like a transaction row, else -1. */
function candidateDateIndex(l: Line): number {
  const idx = l.cells.findIndex((c, i) => i <= 1 && c.kind === 'date');
  if (idx < 0) return -1;
  return l.cells.some((c, i) => i > idx && c.kind === 'amount') ? idx : -1;
}

function countCandidates(lines: Line[]): number {
  return lines.filter((l) => candidateDateIndex(l) >= 0).length;
}

// ---------------------------------------------------------------------------
// Columns
// ---------------------------------------------------------------------------

function headerRoles(l: Line, template?: Template): (ColumnRole | undefined)[] {
  return l.cells.map((c) => (c.kind === 'text' ? roleForHeader(c.text, template?.headers) : undefined));
}

function isHeaderLine(l: Line, template?: Template): boolean {
  if (candidateDateIndex(l) >= 0) return false;
  const roles = headerRoles(l, template);
  const hasDate = roles.includes('date') || roles.includes('valueDate');
  const hasMoneyCol = roles.some((r) => r && NUMERIC_ROLES.has(r));
  const known = roles.filter(Boolean).length;
  return hasDate && hasMoneyCol && known >= 3 && known >= roles.length * 0.6;
}

function findHeaders(lines: Line[], template: Template | undefined, isCandidate: (l: Line) => boolean): Map<number, Column[]> {
  const byPage = new Map<number, Column[]>();
  const pagesWithRows = new Set(lines.filter(isCandidate).map((l) => l.page));
  for (const l of lines) {
    if (byPage.has(l.page) || !pagesWithRows.has(l.page) || !isHeaderLine(l, template)) continue;
    const roles = headerRoles(l, template);
    const columns: Column[] = l.cells.map((c, index) => {
      const role = roles[index] ?? 'ignore';
      return { index, role, label: c.text, x0: c.x0, x1: c.x1, numeric: NUMERIC_ROLES.has(role), source: 'header' };
    });
    // Two columns both called "date": the second is the value date.
    const dates = columns.filter((c) => c.role === 'date');
    if (dates.length > 1 && !columns.some((c) => c.role === 'valueDate')) dates[1]!.role = 'valueDate';
    byPage.set(l.page, columns);
  }
  return byPage;
}

/** No header row: work out the columns from the shape of the data. */
function inferColumns(rows: Line[]): Column[] {
  const columns: Column[] = [];
  if (rows.length === 0) return columns;

  const firstDates = rows.map((l) => l.cells[candidateDateIndex(l)]!);
  const dateX0 = Math.min(...firstDates.map((c) => c.x0));
  const dateX1 = Math.max(...firstDates.map((c) => c.x1));
  columns.push({ index: 0, role: 'date', x0: dateX0, x1: dateX1, numeric: false, source: 'inferred' });

  const secondDates = rows
    .map((l) => l.cells.filter((c) => c.kind === 'date')[1])
    .filter((c): c is Cell => c !== undefined);
  if (secondDates.length >= rows.length * 0.5) {
    columns.push({
      index: 1,
      role: 'valueDate',
      x0: Math.min(...secondDates.map((c) => c.x0)),
      x1: Math.max(...secondDates.map((c) => c.x1)),
      numeric: false,
      source: 'inferred',
    });
  }

  // Cluster amount cells by right edge (numbers are usually right-aligned).
  const amountCells = rows.flatMap((l, row) => l.cells.filter((c) => c.kind === 'amount').map((c) => ({ c, row })));
  const sorted = [...amountCells].sort((a, b) => a.c.x1 - b.c.x1);
  const clusters: { x0: number; x1: number; rows: Set<number>; sum: number; n: number }[] = [];
  for (const a of sorted) {
    const cl = clusters[clusters.length - 1];
    if (cl && Math.abs(a.c.x1 - cl.sum / cl.n) <= 15) {
      cl.x0 = Math.min(cl.x0, a.c.x0);
      cl.x1 = Math.max(cl.x1, a.c.x1);
      cl.rows.add(a.row);
      cl.sum += a.c.x1;
      cl.n++;
    } else {
      clusters.push({ x0: a.c.x0, x1: a.c.x1, rows: new Set([a.row]), sum: a.c.x1, n: 1 });
    }
  }
  let significant = clusters.filter((cl) => cl.rows.size >= Math.max(1, rows.length * 0.1));
  // Numbers don't line up in columns (e.g. each row is one run of text): fall back to reading
  // amounts by their order in the row — see buildRow.
  const largestShare = Math.max(0, ...significant.map((cl) => cl.rows.size)) / rows.length;
  const estimated = amountCells.filter((a) => a.c.estimated).length;
  if (significant.length > 4 || largestShare < 0.5 || estimated > amountCells.length / 2) significant = [];
  const roles: ColumnRole[] = significant.map(() => 'ignore');
  const n = significant.length;
  const share = (i: number) => significant[i]!.rows.size / rows.length;
  if (n === 1) roles[0] = 'amount';
  else if (n === 2) {
    const both = [...significant[0]!.rows].filter((r) => significant[1]!.rows.has(r)).length;
    if (both <= rows.length * 0.1) {
      roles[0] = 'debit';
      roles[1] = 'credit';
    } else {
      roles[0] = 'amount';
      roles[1] = 'balance';
    }
  } else if (n >= 3) {
    const balanceLast = share(n - 1) >= 0.8;
    if (balanceLast) {
      roles[n - 1] = 'balance';
      roles[n - 2] = 'credit';
      roles[n - 3] = 'debit';
    } else {
      roles[n - 1] = 'credit';
      roles[n - 2] = 'debit';
    }
  }

  const lastDateX1 = columns[columns.length - 1]!.x1;
  const firstNumX0 = significant[0]?.x0 ?? Infinity;
  if (firstNumX0 - lastDateX1 > 4) {
    columns.push({
      index: columns.length,
      role: 'description',
      x0: lastDateX1 + 2,
      x1: Number.isFinite(firstNumX0) ? firstNumX0 - 2 : lastDateX1 + 400,
      numeric: false,
      source: 'inferred',
    });
  }
  significant.forEach((cl, i) => {
    columns.push({ index: columns.length, role: roles[i]!, x0: cl.x0, x1: cl.x1, numeric: true, source: 'inferred' });
  });
  return columns;
}

/** Which column does a cell belong to? */
function columnFor(cell: Cell, columns: Column[]): Column | undefined {
  const cx = (cell.x0 + cell.x1) / 2;
  if (cell.kind === 'amount') {
    let best: Column | undefined;
    let bestD = Infinity;
    for (const col of columns) {
      if (!col.numeric) continue;
      const d = Math.min(Math.abs(cx - (col.x0 + col.x1) / 2), Math.abs(cell.x1 - col.x1), Math.abs(cell.x0 - col.x0));
      if (d < bestD) {
        bestD = d;
        best = col;
      }
    }
    if (best && bestD <= Math.max(60, (best.x1 - best.x0) * 1.5)) return best;
    return undefined;
  }
  const pool = columns.filter((c) =>
    !c.numeric && (cell.kind === 'date' ? true : c.role !== 'date' && c.role !== 'valueDate'),
  );
  let best: Column | undefined;
  let bestOverlap = 0;
  for (const col of pool) {
    const overlap = Math.min(cell.x1, col.x1) - Math.max(cell.x0, col.x0);
    if (overlap > bestOverlap) {
      bestOverlap = overlap;
      best = col;
    }
  }
  if (best) return best;
  let nearest: Column | undefined;
  let nearestD = 30;
  for (const col of pool) {
    const d = Math.abs(cx - (col.x0 + col.x1) / 2);
    if (d < nearestD) {
      nearestD = d;
      nearest = col;
    }
  }
  return nearest;
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

function buildRow(line: Line, columns: Column[], sectionSign: -1 | 0 | 1, inheritDate?: RawDate): Row | undefined {
  const row: Row = {
    page: line.page,
    y: line.y,
    description: [],
    reference: [],
    sign: 0,
    sectionSign,
  };
  const dateIdx = candidateDateIndex(line);
  if (dateIdx >= 0) row.date = line.cells[dateIdx]!.date;
  else if (inheritDate) row.date = inheritDate;
  else return undefined;

  // No numeric columns known: the last amount is the balance (if there are two), the other the amount.
  const ordinal = new Map<Cell, ColumnRole>();
  if (!columns.some((c) => c.numeric)) {
    const amounts = line.cells.filter((c) => c.kind === 'amount');
    if (amounts.length >= 2) {
      ordinal.set(amounts[amounts.length - 1]!, 'balance');
      ordinal.set(amounts[amounts.length - 2]!, 'amount');
    } else if (amounts.length === 1) ordinal.set(amounts[0]!, 'amount');
  }

  line.cells.forEach((cell, i) => {
    if (i === dateIdx) return;
    const role = ordinal.get(cell) ?? columnFor(cell, columns)?.role;

    if (cell.kind === 'amount' && role && NUMERIC_ROLES.has(role)) {
      const p = parseAmount(cell.text);
      if (!p) return;
      const signed = p.sign === -1 ? -p.value : p.value;
      if (role === 'balance') row.balance = signed;
      else if (role === 'debit') row.debit = (row.debit ?? 0) + p.value;
      else if (role === 'credit') row.credit = (row.credit ?? 0) + p.value;
      else if (row.amount === undefined) {
        row.amount = p.value;
        if (p.sign !== 0) row.sign = p.sign;
      }
      return;
    }
    if (cell.kind === 'date' && (role === 'valueDate' || (role === undefined && !row.valueDate))) {
      if (!row.valueDate) {
        row.valueDate = cell.date;
        return;
      }
    }
    if (role === 'ignore' || role === 'date') return;
    if (role === 'sign') {
      const t = cell.text.trim().toUpperCase();
      if (/^(DR|D|-|S|DEBIT)$/.test(t)) row.sign = -1;
      else if (/^(CR|C|\+|H|CREDIT)$/.test(t)) row.sign = 1;
      else row.description.push(cell.text);
      return;
    }
    if (role === 'reference') {
      row.reference.push(cell.text);
      return;
    }
    row.description.push(cell.text);
  });
  return row;
}

function hasMoney(r: Row): boolean {
  return r.debit !== undefined || r.credit !== undefined || r.amount !== undefined;
}

// ---------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------

function resolveTemplate(t: ParseOptions['template'], text: string): Template | undefined {
  if (t === false) return undefined;
  if (typeof t === 'object') return t;
  if (typeof t === 'string') return findTemplate(t);
  return matchTemplate(text);
}

function typicalLineGap(lines: Line[]): number {
  const gaps: number[] = [];
  for (let i = 1; i < lines.length; i++) {
    const a = lines[i - 1]!;
    const b = lines[i]!;
    if (a.page === b.page && b.y > a.y) gaps.push(b.y - a.y);
  }
  if (gaps.length === 0) return 14;
  gaps.sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length * 0.25)] ?? 14;
}

function guessYear(rows: Row[], text: string): number {
  const years = rows.map((r) => r.date?.year ?? (r.date?.yearFirst ? r.date.parts?.[0] : r.date?.parts?.[2])).filter(
    (y): y is number => typeof y === 'number',
  );
  if (years.length) return Math.max(...years);
  const inText = [...text.matchAll(/\b(19[89]\d|20\d{2})\b/g)].map((m) => Number(m[1]));
  if (inText.length) return Math.max(...inText);
  return new Date().getFullYear();
}

function near(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.005;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
