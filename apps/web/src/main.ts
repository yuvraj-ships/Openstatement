import '@fontsource/instrument-serif/400.css';
import '@fontsource/instrument-serif/400-italic.css';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import './style.css';
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import {
  PdfPasswordError,
  getInsights,
  mergeStatements,
  parseLines,
  readPdf,
  templateFromResult,
  templates,
  toCSV,
  toJSON,
  toOFX,
  toQIF,
  type Column,
  type ColumnRole,
  type Insights,
  type ParseOptions,
  type ParseResult,
  type PdfJsLike,
  type TextLine,
  type Transaction,
} from 'openstatement';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
const lib = pdfjs as unknown as PdfJsLike;

const REPO_URL = 'https://github.com/yuvraj-ships/Openstatement';

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> & { className?: string } = {},
  ...children: (Node | string | null | undefined | false)[]
): HTMLElementTagNameMap[K] {
  const el = Object.assign(document.createElement(tag), props);
  for (const c of children) if (c != null && c !== false) el.append(c);
  return el;
}

function svg(markup: string): SVGElement {
  const t = document.createElement('template');
  t.innerHTML = markup.trim();
  return t.content.firstElementChild as SVGElement;
}

const b = (text: string) => h('b', {}, text);

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

interface Statement {
  name: string;
  lines: TextLine[];
  /** Column layout the user corrected for this statement. */
  columns?: Column[];
  result: ParseResult;
}

interface FileItem {
  name: string;
  data: Uint8Array;
}

let statements: Statement[] = [];
/** Which statement the "Fix the reading" panel edits. */
let active = 0;
/** The combined view across all statements. */
let view: ParseResult | undefined;
let duplicatesRemoved = 0;
let insights: Insights | undefined;

const ROLE_LABELS: Record<ColumnRole, string> = {
  date: 'Date',
  valueDate: 'Value date',
  description: 'Description',
  reference: 'Reference',
  debit: 'Money out',
  credit: 'Money in',
  amount: 'Amount ±',
  balance: 'Balance',
  sign: 'DR / CR mark',
  ignore: 'Ignore',
};

/** Seven validated categorical slots (CSS vars switch for dark mode). The rest folds into "Everything else". */
const CATEGORY_SLOTS = 7;

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

/** Ask for a PDF password. Resolves to null if the user skips the file. */
function askPassword(name: string, reason: 'required' | 'incorrect'): Promise<string | null> {
  const dialog = $<HTMLDialogElement>('password-dialog');
  $('password-msg').textContent =
    reason === 'incorrect' ? `That password didn’t work for “${name}”. Try again?` : `“${name}” is protected with a password.`;
  const input = $<HTMLInputElement>('password');
  input.value = '';
  dialog.returnValue = '';
  dialog.showModal();
  input.focus();
  return new Promise((resolve) => {
    dialog.addEventListener('close', () => resolve(dialog.returnValue === 'ok' ? input.value : null), { once: true });
  });
}

async function readOne(item: FileItem, password?: string): Promise<boolean> {
  try {
    // pdf.js may take ownership of the buffer, so keep our own copy for password retries.
    const lines = await readPdf(item.data.slice(), { pdfjs: lib, password });
    statements.push({ name: item.name, lines, result: parseLines(lines, globalOptions()) });
    return true;
  } catch (err) {
    if (err instanceof PdfPasswordError) {
      const pw = await askPassword(item.name, err.reason);
      return pw === null ? false : readOne(item, pw);
    }
    console.error(err);
    return false;
  }
}

async function addFiles(items: FileItem[], replace: boolean) {
  const pdfs = items.filter((f) => /\.pdf$/i.test(f.name));
  if (!pdfs.length) {
    setStatus('Please choose PDF files.', true);
    return;
  }
  if (replace) {
    statements = [];
    resetOptions();
  }
  const failed: string[] = [];
  let skipped = 0;
  for (const [i, item] of pdfs.entries()) {
    if (statements.some((s) => s.name === item.name)) {
      skipped++;
      continue;
    }
    setStatus(pdfs.length > 1 ? `Reading ${i + 1} of ${pdfs.length}: ${item.name}…` : 'Reading your statement…');
    if (!(await readOne(item))) failed.push(item.name);
  }
  setStatus(
    [failed.length ? `Couldn’t read: ${failed.join(', ')}.` : '', skipped ? `${skipped} file(s) were already added.` : '']
      .filter(Boolean)
      .join(' '),
    failed.length > 0,
  );
  if (statements.length) {
    active = Math.min(active, statements.length - 1);
    recompute();
    if ($('results').hidden) showResults(true);
  }
}

async function filesFromList(list: FileList | null | undefined): Promise<FileItem[]> {
  return Promise.all([...(list ?? [])].map(async (f) => ({ name: f.name, data: new Uint8Array(await f.arrayBuffer()) })));
}

function setStatus(text: string, error = false) {
  for (const id of ['status', 'files-note-status']) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.textContent = text;
    el.classList.toggle('error', error);
  }
}

function showResults(on: boolean) {
  $('landing').hidden = on;
  $('results').hidden = !on;
  window.scrollTo({ top: 0 });
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

function globalOptions(): ParseOptions {
  const opts: ParseOptions = {};
  const tpl = $<HTMLSelectElement>('opt-template').value;
  if (tpl) opts.template = tpl;
  const date = $<HTMLSelectElement>('opt-date').value;
  if (date) opts.dateOrder = date as ParseOptions['dateOrder'];
  const dec = $<HTMLSelectElement>('opt-decimal').value;
  if (dec) opts.numberFormat = { decimal: dec as '.' | ',' };
  const cur = $<HTMLInputElement>('opt-currency').value.trim().toUpperCase();
  if (/^[A-Z]{3}$/.test(cur)) opts.currency = cur;
  return opts;
}

function resetOptions() {
  $<HTMLSelectElement>('opt-template').value = '';
  $<HTMLSelectElement>('opt-date').value = '';
  $<HTMLSelectElement>('opt-decimal').value = '';
  $<HTMLInputElement>('opt-currency').value = '';
  $<HTMLInputElement>('search').value = '';
  ($('adjust') as HTMLDetailsElement).open = false;
  active = 0;
}

/** Re-parse every statement with the current options and rebuild the combined view. */
function recompute() {
  const opts = globalOptions();
  for (const s of statements) s.result = parseLines(s.lines, s.columns ? { ...opts, columns: s.columns } : opts);

  const merged = mergeStatements(statements.map((s) => ({ name: s.name.replace(/\.pdf$/i, ''), transactions: s.result.transactions })));
  duplicatesRemoved = merged.duplicatesRemoved;
  const first = statements[0]!.result.meta;
  const many = statements.length > 1;
  view = {
    transactions: merged.transactions,
    meta: {
      ...first,
      columns: statements[active]!.result.meta.columns,
      balanceCheck: statements.reduce(
        (acc, s) => ({ checked: acc.checked + s.result.meta.balanceCheck.checked, matched: acc.matched + s.result.meta.balanceCheck.matched }),
        { checked: 0, matched: 0 },
      ),
      warnings: statements.flatMap((s) => s.result.meta.warnings.map((w) => (many ? `${s.name}: ${w}` : w))),
    },
  };
  insights = getInsights(merged.transactions);
  render();
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

function money(n: number, currency?: string, signed = false, headline = false) {
  const opts: Intl.NumberFormatOptions = currency
    ? { style: 'currency', currency, currencyDisplay: 'narrowSymbol' }
    : { minimumFractionDigits: 2, maximumFractionDigits: 2 };
  if (signed) opts.signDisplay = 'exceptZero';
  // Big headline figures read better without cents.
  if (headline && Math.abs(n) >= 1000) {
    opts.minimumFractionDigits = 0;
    opts.maximumFractionDigits = 0;
  }
  try {
    return new Intl.NumberFormat(undefined, opts).format(n);
  } catch {
    return (signed && n > 0 ? '+' : '') + n.toFixed(2);
  }
}

/** Short axis labels: 1.2k, 85k, 1.1M */
function compact(n: number) {
  return new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(n);
}

const dateFmt = new Intl.DateTimeFormat(undefined, { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
const shortDate = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' });
const monthFmt = new Intl.DateTimeFormat(undefined, { month: 'short', year: 'numeric', timeZone: 'UTC' });
const monthLong = new Intl.DateTimeFormat(undefined, { month: 'long', timeZone: 'UTC' });
const fmtDate = (iso: string, f = dateFmt) => f.format(new Date(`${iso}T00:00:00Z`));
const fmtMonth = (ym: string, f = monthFmt) => f.format(new Date(`${ym}-01T00:00:00Z`));

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function render() {
  if (!view || !insights) return;
  const { transactions: txs, meta } = view;
  const many = statements.length > 1;
  $('file-name').textContent = many ? `${statements.length} statements` : statements[0]!.name.replace(/\.pdf$/i, '');

  const dateLabel = { DMY: 'DD/MM', MDY: 'MM/DD', YMD: 'YYYY-MM-DD' }[meta.dateOrder];
  $('detected').textContent = [
    meta.currency ?? '—',
    dateLabel,
    meta.numberFormat.decimal === ',' ? '1.234,56' : '1,234.56',
    meta.template ? (templates.find((t) => t.id === meta.template)?.name ?? meta.template) : null,
  ]
    .filter(Boolean)
    .join('  ·  ');

  renderFigures(txs, meta.currency);
  renderVerdict(meta);
  $('warnings').replaceChildren(...meta.warnings.map((w) => h('li', {}, w)));
  if (meta.warnings.length) ($('adjust') as HTMLDetailsElement).open = true;

  renderFiles();
  renderInsights(insights, meta.currency);
  renderMonthly(insights, meta.currency);
  renderRecurring(insights, meta.currency);
  renderBreakdown('categories', 'out-total', txs.filter((t) => t.amount < 0), meta.currency);
  renderBreakdown('income', 'in-total', txs.filter((t) => t.amount > 0), meta.currency);
  renderStatementPicker();
  renderColumns(meta.columns);
  renderRows();
}

function renderFigures(txs: Transaction[], currency?: string) {
  const inflow = txs.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0);
  const outflow = txs.filter((t) => t.amount < 0).reduce((s, t) => s - t.amount, 0);
  const period = txs.length ? `${fmtDate(txs[0]!.date, shortDate)} – ${fmtDate(txs[txs.length - 1]!.date)}` : '—';
  const fig = (label: string, value: string, cls = '', sub?: string) =>
    h('div', { className: `figure ${cls}` }, h('dt', {}, label), h('dd', {}, value), sub ? h('span', { className: 'figure-sub' }, sub) : null);
  $('figures').replaceChildren(
    fig('Transactions', String(txs.length), '', period),
    fig('Money in', money(inflow, currency, false, true), 'in', `${txs.filter((t) => t.amount > 0).length} credits`),
    fig('Money out', money(outflow, currency, false, true), 'out', `${txs.filter((t) => t.amount < 0).length} debits`),
    fig('Net change', money(inflow - outflow, currency, true, true), inflow - outflow >= 0 ? 'in' : 'out', 'over the period'),
  );
}

function renderVerdict(meta: ParseResult['meta']) {
  const { checked, matched } = meta.balanceCheck;
  let tone: 'ok' | 'warn' | 'neutral';
  let word: string;
  let detail: string;
  if (checked > 0 && matched === checked) {
    tone = 'ok';
    word = 'BALANCED';
    detail = `All ${checked} running balances add up, so every amount and its sign is confirmed.`;
  } else if (checked > 0) {
    tone = 'warn';
    word = 'CHECK ROWS';
    detail = `${matched} of ${checked} running balances add up. Review the rows below or fix the columns.`;
  } else {
    tone = 'neutral';
    word = 'UNVERIFIED';
    detail = 'No running balance to check against, so amounts couldn’t be cross-checked.';
  }
  const label = checked > 0 ? `${matched}/${checked}` : '—';
  $('verdict').className = `verdict ${tone}`;
  $('verdict').replaceChildren(
    svg(`<svg class="verdict-stamp" viewBox="0 0 120 120" aria-hidden="true">
      <circle cx="60" cy="60" r="56" fill="none" stroke="currentColor" stroke-width="2.5"/>
      <circle cx="60" cy="60" r="46" fill="none" stroke="currentColor" stroke-width="1"/>
      <text x="60" y="56" text-anchor="middle" class="vs-word">${word}</text>
      <text x="60" y="76" text-anchor="middle" class="vs-num">${label}</text>
    </svg>`),
    h('p', {}, detail),
  );
}

function renderFiles() {
  $('files').replaceChildren(
    ...statements.map((s, i) => {
      const txs = s.result.transactions;
      const { checked, matched } = s.result.meta.balanceCheck;
      const ok = checked === 0 || matched === checked;
      const remove = h('button', { type: 'button', className: 'file-remove', title: `Remove ${s.name}`, ariaLabel: `Remove ${s.name}` }, '×');
      remove.addEventListener('click', () => {
        statements.splice(i, 1);
        if (!statements.length) {
          showResults(false);
          return;
        }
        active = Math.min(active, statements.length - 1);
        recompute();
      });
      return h(
        'li',
        { className: `file ${ok ? '' : 'warn'}` },
        h('span', { className: 'file-mark', ariaHidden: 'true' }, ok ? '✓' : '!'),
        h(
          'span',
          { className: 'file-body' },
          h('span', { className: 'file-name' }, s.name.replace(/\.pdf$/i, '')),
          h(
            'span',
            { className: 'file-meta mono' },
            txs.length ? `${txs.length} rows · ${fmtDate(txs[0]!.date, shortDate)} – ${fmtDate(txs[txs.length - 1]!.date, shortDate)}` : 'no rows found',
          ),
        ),
        remove,
      );
    }),
  );
  $('files-note').replaceChildren(
    statements.length > 1
      ? duplicatesRemoved
        ? h('span', {}, 'Merged into one list. ', b(`${duplicatesRemoved} duplicate row${duplicatesRemoved === 1 ? '' : 's'}`), ' from overlapping dates removed.')
        : 'Merged into one list, oldest first.'
      : 'Add more months to see trends and find repeating payments.',
    h('span', { id: 'files-note-status', className: 'status-inline' }),
  );
}

function renderInsights(ins: Insights, cur?: string) {
  const items: (Node | string)[][] = [];
  const n = ins.months.length;
  if (ins.totals.moneyOut > 0) {
    items.push(
      n > 1
        ? ['You spent ', b(money(ins.totals.moneyOut, cur)), ` over ${n} months — about `, b(money(ins.averageMonthlySpend, cur)), ' a month.']
        : ['You spent ', b(money(ins.totals.moneyOut, cur)), ` in ${fmtMonth(ins.months[0]!.month, monthLong)}.`],
    );
  }
  if (ins.topCategory) {
    items.push([h('em', {}, ins.topCategory.category), ' is your biggest category: ', b(`${Math.round(ins.topCategory.share)}%`), ' of all spending.']);
  }
  if (ins.categoryChange && ins.categoryChange.change !== 0) {
    const c = ins.categoryChange;
    items.push([
      h('em', {}, c.category),
      ` spending went ${c.change > 0 ? 'up' : 'down'} `,
      b(`${Math.abs(c.change)}%`),
      ` in ${fmtMonth(c.month, monthLong)} (${money(c.current, cur)} vs ${money(c.previous, cur)} in ${fmtMonth(c.previousMonth, monthLong)}).`,
    ]);
  }
  if (ins.biggestExpense) {
    const t = ins.biggestExpense;
    items.push(['Biggest single expense: ', b(money(-t.amount, cur)), ` — ${t.description} on ${fmtDate(t.date, shortDate)}.`]);
  }
  if (ins.recurring.length) {
    const yearly = ins.recurring.reduce((s, r) => s + r.perYear, 0);
    items.push([
      b(`${ins.recurring.length} repeating payment${ins.recurring.length === 1 ? '' : 's'}`),
      ' found, costing about ',
      b(money(yearly, cur)),
      ' a year.',
    ]);
  } else if (n < 2) {
    items.push(['Add another month of statements to spot subscriptions and other repeating payments.']);
  }
  const best = ins.months.length > 1 ? [...ins.months].sort((a, b2) => b2.net - a.net)[0] : undefined;
  if (best && best.net > 0) items.push(['Best month for saving: ', h('em', {}, fmtMonth(best.month, monthLong)), ', with ', b(money(best.net, cur, true)), ' left over.']);

  $('insights').replaceChildren(...items.map((parts) => h('li', {}, ...parts)));
}

/** Grouped bars: money in vs money out per month. Hidden for a single month. */
function renderMonthly(ins: Insights, cur?: string) {
  const months = ins.months;
  $('monthly-block').hidden = months.length < 2;
  if (months.length < 2) return;

  const max = Math.max(...months.flatMap((m) => [m.moneyIn, m.moneyOut]), 1);
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1]!;

  const plot = h('div', { className: 'mplot' });
  const grid = h('div', { className: 'mgrid', ariaHidden: 'true' });
  for (const t of ticks) {
    const line = h('div', { className: 'mgrid-line' }, h('span', { className: 'mono' }, compact(t)));
    line.style.bottom = `${(t / top) * 100}%`;
    grid.append(line);
  }
  const bars = h('div', { className: 'mbars' });
  const tip = h('div', { className: 'mtip', role: 'status' });
  tip.hidden = true;

  months.forEach((m) => {
    const bar = (cls: string, v: number) => {
      const el = h('span', { className: `mbar ${cls}` });
      el.style.height = `${(v / top) * 100}%`;
      return el;
    };
    const label = `${fmtMonth(m.month)}: money in ${money(m.moneyIn, cur)}, money out ${money(m.moneyOut, cur)}, net ${money(m.net, cur, true)}`;
    const col = h(
      'div',
      { className: 'mcol', tabIndex: 0, ariaLabel: label },
      h('div', { className: 'mpair' }, bar('in', m.moneyIn), bar('out', m.moneyOut)),
      h('span', { className: 'mlabel mono' }, fmtMonth(m.month)),
    );
    const show = () => {
      tip.replaceChildren(
        h('b', {}, fmtMonth(m.month)),
        h('span', {}, h('i', { className: 'sw sw-in' }), 'In ', h('span', { className: 'mono' }, money(m.moneyIn, cur))),
        h('span', {}, h('i', { className: 'sw sw-out' }), 'Out ', h('span', { className: 'mono' }, money(m.moneyOut, cur))),
        h('span', { className: 'muted' }, 'Net ', h('span', { className: 'mono' }, money(m.net, cur, true))),
      );
      tip.hidden = false;
      const pr = plot.getBoundingClientRect();
      const cr = col.getBoundingClientRect();
      const x = cr.left - pr.left + cr.width / 2;
      tip.style.left = `${Math.min(Math.max(x, 80), pr.width - 80)}px`;
      col.classList.add('hot');
    };
    const hide = () => {
      tip.hidden = true;
      col.classList.remove('hot');
    };
    col.addEventListener('mouseenter', show);
    col.addEventListener('focus', show);
    col.addEventListener('mouseleave', hide);
    col.addEventListener('blur', hide);
    bars.append(col);
  });
  plot.append(grid, bars, tip);
  $('monthly').replaceChildren(plot);

  $('monthly-table').replaceChildren(
    ...months.map((m) =>
      h(
        'tr',
        {},
        h('td', { className: 'mono' }, fmtMonth(m.month)),
        h('td', { className: 'num mono' }, money(m.moneyIn, cur)),
        h('td', { className: 'num mono' }, money(m.moneyOut, cur)),
        h('td', { className: `num mono ${m.net >= 0 ? 'in' : ''}` }, money(m.net, cur, true)),
      ),
    ),
  );
}

/** 3–5 round tick values from 0 to just above max. */
function niceTicks(max: number): number[] {
  const rough = max / 4;
  const pow = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= rough) ?? 10 * pow;
  const ticks: number[] = [];
  for (let v = step; v < max + step; v += step) ticks.push(v);
  return ticks;
}

function renderRecurring(ins: Insights, cur?: string) {
  const list = ins.recurring;
  $('recurring-block').hidden = list.length === 0;
  if (!list.length) return;
  const yearly = list.reduce((s, r) => s + r.perYear, 0);
  $('recurring-total').textContent = `≈ ${money(yearly, cur)} / year`;
  $('recurring').replaceChildren(
    ...list.map((r) =>
      h(
        'li',
        {},
        h('span', { className: 'rec-name' }, r.name, h('span', { className: 'rec-sub' }, `${r.category ?? 'Other'} · seen ${r.months} months · last ${fmtDate(r.lastDate, shortDate)}`)),
        h('span', { className: 'rec-amt mono' }, money(r.amount, cur), h('span', { className: 'rec-per' }, ' / mo')),
        h('span', { className: 'rec-year mono muted' }, `${money(r.perYear, cur)} / yr`),
      ),
    ),
  );
}

function renderBreakdown(id: string, totalId: string, txs: Transaction[], currency?: string) {
  const el = $(id);
  const totals = new Map<string, number>();
  for (const t of txs) totals.set(t.category ?? 'Other', (totals.get(t.category ?? 'Other') ?? 0) + Math.abs(t.amount));
  let sorted = [...totals].sort((a, b2) => b2[1] - a[1]);
  if (sorted.length > CATEGORY_SLOTS) {
    const rest = sorted.slice(CATEGORY_SLOTS - 1).reduce((s, [, v]) => s + v, 0);
    sorted = [...sorted.slice(0, CATEGORY_SLOTS - 1), ['Everything else', rest]];
  }
  const sum = sorted.reduce((s, [, v]) => s + v, 0);
  $(totalId).textContent = sum ? money(sum, currency) : '';
  if (!sorted.length) {
    el.replaceChildren(h('p', { className: 'muted empty' }, 'Nothing in this direction.'));
    return;
  }
  const bar = h('div', { className: 'stack', role: 'img', ariaLabel: sorted.map(([n, v]) => `${n} ${Math.round((v / sum) * 100)}%`).join(', ') });
  const legend = h('ul', { className: 'legend' });
  sorted.forEach(([name, value], i) => {
    const color = name === 'Everything else' ? 'var(--ink-3)' : `var(--cat-${i + 1})`;
    const seg = h('span', { className: 'stack-seg', title: `${name}: ${money(value, currency)}` });
    seg.style.flexGrow = String(value);
    seg.style.background = color;
    bar.append(seg);
    const swatch = h('span', { className: 'swatch' });
    swatch.style.background = color;
    legend.append(
      h(
        'li',
        {},
        swatch,
        h('span', { className: 'legend-name' }, name),
        h('span', { className: 'legend-pct mono' }, `${Math.round((value / sum) * 100)}%`),
        h('span', { className: 'legend-val mono' }, money(value, currency)),
      ),
    );
  });
  el.replaceChildren(bar, legend);
}

function renderStatementPicker() {
  const pick = $<HTMLSelectElement>('opt-statement');
  $('statement-pick').hidden = statements.length < 2;
  pick.replaceChildren(...statements.map((s, i) => h('option', { value: String(i), selected: i === active }, s.name)));
}

function renderColumns(columns: Column[]) {
  const roles = Object.keys(ROLE_LABELS) as ColumnRole[];
  const sorted = columns.map((c, i) => ({ c, i })).sort((a, b2) => a.c.x0 - b2.c.x0);
  const min = Math.min(...columns.map((c) => c.x0));
  const max = Math.max(...columns.map((c) => c.x1));
  const span = Math.max(1, max - min);

  $('columns').replaceChildren(
    ...sorted.map(({ c: col, i }) => {
      const select = h(
        'select',
        { ariaLabel: `What column “${col.label ?? i + 1}” contains` },
        ...roles.map((r) => h('option', { value: r, selected: r === col.role }, ROLE_LABELS[r])),
      );
      select.addEventListener('change', () => {
        const role = select.value as ColumnRole;
        statements[active]!.columns = columns.map((c, j) =>
          j === i ? { ...c, role, numeric: ['debit', 'credit', 'amount', 'balance'].includes(role), source: 'user' as const } : c,
        );
        recompute();
      });
      const cell = h(
        'div',
        { className: `ruler-col role-${col.role}` },
        h('span', { className: 'ruler-label mono' }, col.label ?? `col ${i + 1}`),
        select,
        h('span', { className: 'ruler-src' }, col.source === 'header' ? 'from header' : col.source === 'user' ? 'set by you' : col.source),
      );
      cell.style.flexGrow = String(Math.max(0.6, (col.x1 - col.x0) / span) * 10);
      return cell;
    }),
  );
}

function renderRows() {
  if (!view) return;
  const q = $<HTMLInputElement>('search').value.trim().toLowerCase();
  const cur = view.meta.currency;
  const many = statements.length > 1;
  const list = view.transactions.filter(
    (t) => !q || t.description.toLowerCase().includes(q) || (t.category ?? '').toLowerCase().includes(q),
  );
  const rows = list.map((t, i) => {
    const tr = h(
      'tr',
      {},
      h('td', { className: 'mono date' }, fmtDate(t.date)),
      h(
        'td',
        { className: 'desc' },
        t.description || h('span', { className: 'muted' }, '(no description)'),
        many && t.source ? h('span', { className: 'row-source' }, t.source) : null,
      ),
      h('td', {}, t.category ? h('span', { className: 'cat' }, t.category) : null),
      h('td', { className: `num mono ${t.amount > 0 ? 'in' : 'out'}` }, money(t.amount, cur, true)),
      h('td', { className: 'num mono muted' }, t.balance !== undefined ? money(t.balance, cur) : ''),
    );
    if (i < 30) tr.style.setProperty('--i', String(i));
    return tr;
  });
  $('rows').replaceChildren(
    ...(rows.length ? rows : [h('tr', {}, h('td', { colSpan: 5, className: 'muted empty' }, q ? 'No matches.' : 'No transactions found.'))]),
  );
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

function download(content: string, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = h('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportAs(kind: string) {
  if (!view) return;
  const t = view.transactions;
  const n = statements.length > 1 ? 'statements-combined' : statements[0]!.name.replace(/\.pdf$/i, '') || 'statement';
  if (kind === 'csv') download(toCSV(t), `${n}.csv`, 'text/csv');
  if (kind === 'excel') {
    const comma = view.meta.numberFormat.decimal === ',';
    download(toCSV(t, { bom: true, delimiter: comma ? ';' : ',', decimalComma: comma }), `${n}-excel.csv`, 'text/csv');
  }
  if (kind === 'ofx') download(toOFX(view), `${n}.ofx`, 'application/x-ofx');
  if (kind === 'qif') download(toQIF(t), `${n}.qif`, 'application/qif');
  if (kind === 'json') download(toJSON(view), `${n}.json`, 'application/json');
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

function init() {
  document.querySelectorAll<HTMLAnchorElement>('.repo-link').forEach((a) => (a.href = REPO_URL));

  $<HTMLSelectElement>('opt-template').replaceChildren(
    h('option', { value: '' }, 'Auto-detect'),
    ...templates.map((t) => h('option', { value: t.id }, t.name)),
  );

  const input = $<HTMLInputElement>('file');
  input.addEventListener('change', async () => {
    const items = await filesFromList(input.files);
    input.value = '';
    void addFiles(items, true);
  });
  const more = $<HTMLInputElement>('file-more');
  more.addEventListener('change', async () => {
    const items = await filesFromList(more.files);
    more.value = '';
    void addFiles(items, false);
  });
  document.querySelector('.add-files')!.addEventListener('keydown', (e) => {
    const k = (e as KeyboardEvent).key;
    if (k === 'Enter' || k === ' ') {
      e.preventDefault();
      more.click();
    }
  });

  const drop = $('drop');
  drop.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      input.click();
    }
  });
  // Drop anywhere on the page. On the results page, dropped files are added to the view.
  let depth = 0;
  window.addEventListener('dragenter', (e) => {
    e.preventDefault();
    depth++;
    document.body.classList.add('dragging');
  });
  window.addEventListener('dragleave', () => {
    if (--depth <= 0) {
      depth = 0;
      document.body.classList.remove('dragging');
    }
  });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', async (e) => {
    e.preventDefault();
    depth = 0;
    document.body.classList.remove('dragging');
    const items = await filesFromList(e.dataTransfer?.files);
    // On the landing page a drop starts fresh; on the results page it adds to the view.
    if (items.length) void addFiles(items, $('results').hidden !== false);
  });

  for (const id of ['opt-template', 'opt-date', 'opt-decimal']) $(id).addEventListener('change', recompute);
  $('opt-currency').addEventListener('input', recompute);
  $('opt-statement').addEventListener('change', () => {
    active = Number($<HTMLSelectElement>('opt-statement').value);
    recompute();
  });
  $('search').addEventListener('input', renderRows);

  const menu = document.querySelector<HTMLDetailsElement>('.menu')!;
  document.querySelectorAll<HTMLButtonElement>('[data-export]').forEach((btn) =>
    btn.addEventListener('click', () => {
      exportAs(btn.dataset.export!);
      menu.open = false;
    }),
  );
  document.addEventListener('click', (e) => {
    if (menu.open && !menu.contains(e.target as Node)) menu.open = false;
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') menu.open = false;
  });

  $('reset').addEventListener('click', () => {
    statements = [];
    view = undefined;
    insights = undefined;
    showResults(false);
  });

  const dialog = $<HTMLDialogElement>('template-dialog');
  $('save-template').addEventListener('click', () => dialog.showModal());
  dialog.addEventListener('close', () => {
    const result = statements[active]?.result;
    if (dialog.returnValue !== 'ok' || !result) return;
    const name = $<HTMLInputElement>('tpl-name').value.trim();
    const country = $<HTMLInputElement>('tpl-country').value.trim().toUpperCase();
    const detect = $<HTMLInputElement>('tpl-detect').value.trim();
    if (!name || !/^[A-Z]{2}$/.test(country)) return;
    const id = `${country.toLowerCase()}-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
    const tpl = templateFromResult(result, { id, name, country, detect: detect ? [detect] : [] });
    download(JSON.stringify(tpl, null, 2) + '\n', `${id}.json`, 'application/json');
  });

  void loadSamples();
}

interface SampleEntry {
  file: string;
  country: string;
  currency: string;
  title: string;
  description: string;
  group?: string;
}

async function loadSamples() {
  try {
    const list = (await (await fetch('./samples/index.json')).json()) as SampleEntry[];
    // Statements of the same account are shown as one entry that loads them all.
    const entries: { items: SampleEntry[]; bank: string; style?: string; description: string }[] = [];
    for (const s of list) {
      const [bank, style] = s.title.split(/\s*\((.*)\)\s*/);
      if (s.group) {
        const existing = entries.find((e) => e.items[0]!.group === s.group);
        if (existing) {
          existing.items.push(s);
          continue;
        }
      }
      entries.push({ items: [s], bank: bank ?? s.title, style, description: s.description });
    }
    // Show the multi-month demo first: it shows off the most features.
    entries.sort((a, z) => z.items.length - a.items.length);
    for (const e of entries) {
      if (e.items.length > 1) {
        e.style = `${e.items.length} monthly statements`;
        e.description = `${e.items.length} months at once — merged, duplicates removed, trends and subscriptions found`;
      }
    }

    $('sample-list').replaceChildren(
      ...entries.map((e) => {
        const first = e.items[0]!;
        const btn = h(
          'button',
          { type: 'button', className: `index-row${e.items.length > 1 ? ' featured' : ''}` },
          h('span', { className: 'index-cc mono' }, first.country),
          h('span', { className: 'index-name' }, e.bank, e.style ? h('span', { className: 'index-style' }, e.style) : null),
          h('span', { className: 'index-desc' }, e.description),
          h('span', { className: 'index-cur mono' }, first.currency),
          h('span', { className: 'index-go', ariaHidden: 'true' }, '→'),
        );
        btn.addEventListener('click', async () => {
          setStatus('Opening sample…');
          const items = await Promise.all(
            e.items.map(async (s) => {
              const [bank, style] = s.title.split(/\s*\((.*)\)\s*/);
              const name = e.items.length > 1 ? `${bank} ${style}.pdf` : `${bank}.pdf`;
              return { name, data: new Uint8Array(await (await fetch(`./samples/${s.file}`)).arrayBuffer()) };
            }),
          );
          await addFiles(items, true);
        });
        return h('li', {}, btn);
      }),
    );
  } catch {
    // Samples are optional.
  }
}

init();
