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

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let pending: { name: string; data: Uint8Array } | undefined;
let lines: TextLine[] = [];
let fileName = '';
let result: ParseResult | undefined;
let userColumns: Column[] | undefined;

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

/** Earthy palette that reads well on paper and on dark. Order = rank. */
const PALETTE = ['#d9541e', '#2f5d8a', '#7a8b3c', '#c99a2e', '#7b4b7a', '#2f7a68', '#b5566b', '#6b7280'];

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

async function load(name: string, data: Uint8Array, password?: string) {
  setStatus('Reading your statement…');
  $('password-form').hidden = true;
  try {
    // pdf.js may take ownership of the buffer, so keep our own copy for password retries.
    lines = await readPdf(data.slice(), { pdfjs: lib, password });
    fileName = name;
    pending = undefined;
    userColumns = undefined;
    resetOptions();
    run();
    setStatus('');
    showResults(true);
  } catch (err) {
    if (err instanceof PdfPasswordError) {
      pending = { name, data };
      $('password-msg').textContent =
        err.reason === 'incorrect' ? 'That password didn’t work. Try again?' : 'This PDF is locked with a password.';
      $('password-form').hidden = false;
      $<HTMLInputElement>('password').value = '';
      $<HTMLInputElement>('password').focus();
      setStatus('');
      return;
    }
    console.error(err);
    setStatus('That file couldn’t be read as a PDF.', true);
  }
}

async function loadFile(file: File) {
  if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') {
    setStatus('That doesn’t look like a PDF.', true);
    return;
  }
  await load(file.name, new Uint8Array(await file.arrayBuffer()));
}

function setStatus(text: string, error = false) {
  const el = $('status');
  el.textContent = text;
  el.classList.toggle('error', error);
}

function showResults(on: boolean) {
  $('landing').hidden = on;
  $('results').hidden = !on;
  window.scrollTo({ top: 0 });
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

function currentOptions(): ParseOptions {
  const opts: ParseOptions = {};
  const tpl = $<HTMLSelectElement>('opt-template').value;
  if (tpl) opts.template = tpl;
  const date = $<HTMLSelectElement>('opt-date').value;
  if (date) opts.dateOrder = date as ParseOptions['dateOrder'];
  const dec = $<HTMLSelectElement>('opt-decimal').value;
  if (dec) opts.numberFormat = { decimal: dec as '.' | ',' };
  const cur = $<HTMLInputElement>('opt-currency').value.trim().toUpperCase();
  if (/^[A-Z]{3}$/.test(cur)) opts.currency = cur;
  if (userColumns) opts.columns = userColumns;
  return opts;
}

function resetOptions() {
  $<HTMLSelectElement>('opt-template').value = '';
  $<HTMLSelectElement>('opt-date').value = '';
  $<HTMLSelectElement>('opt-decimal').value = '';
  $<HTMLInputElement>('opt-currency').value = '';
  $<HTMLInputElement>('search').value = '';
  ($('adjust') as HTMLDetailsElement).open = false;
}

function run() {
  result = parseLines(lines, currentOptions());
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

const dateFmt = new Intl.DateTimeFormat(undefined, { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
const shortDate = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' });
const fmtDate = (iso: string, f = dateFmt) => f.format(new Date(`${iso}T00:00:00Z`));

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function render() {
  if (!result) return;
  const { transactions: txs, meta } = result;
  $('file-name').textContent = fileName.replace(/\.pdf$/i, '');

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

  renderBreakdown('categories', 'out-total', txs.filter((t) => t.amount < 0), meta.currency);
  renderBreakdown('income', 'in-total', txs.filter((t) => t.amount > 0), meta.currency);
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
    detail = 'This statement has no running balance, so amounts couldn’t be cross-checked.';
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

function renderBreakdown(id: string, totalId: string, txs: Transaction[], currency?: string) {
  const el = $(id);
  const totals = new Map<string, number>();
  for (const t of txs) totals.set(t.category ?? 'Other', (totals.get(t.category ?? 'Other') ?? 0) + Math.abs(t.amount));
  let sorted = [...totals].sort((a, b) => b[1] - a[1]);
  if (sorted.length > 7) {
    const rest = sorted.slice(6).reduce((s, [, v]) => s + v, 0);
    sorted = [...sorted.slice(0, 6), ['Everything else', rest]];
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
    const color = PALETTE[i % PALETTE.length]!;
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

function renderColumns(columns: Column[]) {
  const roles = Object.keys(ROLE_LABELS) as ColumnRole[];
  const sorted = columns.map((c, i) => ({ c, i })).sort((a, b) => a.c.x0 - b.c.x0);
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
        userColumns = columns.map((c, j) =>
          j === i ? { ...c, role, numeric: ['debit', 'credit', 'amount', 'balance'].includes(role), source: 'user' as const } : c,
        );
        run();
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
  if (!result) return;
  const q = $<HTMLInputElement>('search').value.trim().toLowerCase();
  const cur = result.meta.currency;
  const list = result.transactions.filter(
    (t) => !q || t.description.toLowerCase().includes(q) || (t.category ?? '').toLowerCase().includes(q),
  );
  const rows = list.map((t, i) => {
    const tr = h(
      'tr',
      {},
      h('td', { className: 'mono date' }, fmtDate(t.date)),
      h('td', { className: 'desc' }, t.description || h('span', { className: 'muted' }, '(no description)')),
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
  if (!result) return;
  const t = result.transactions;
  const n = fileName.replace(/\.pdf$/i, '') || 'statement';
  if (kind === 'csv') download(toCSV(t), `${n}.csv`, 'text/csv');
  if (kind === 'excel') {
    const comma = result.meta.numberFormat.decimal === ',';
    download(toCSV(t, { bom: true, delimiter: comma ? ';' : ',', decimalComma: comma }), `${n}-excel.csv`, 'text/csv');
  }
  if (kind === 'ofx') download(toOFX(result), `${n}.ofx`, 'application/x-ofx');
  if (kind === 'qif') download(toQIF(t), `${n}.qif`, 'application/qif');
  if (kind === 'json') download(toJSON(result), `${n}.json`, 'application/json');
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
  input.addEventListener('change', () => {
    const f = input.files?.[0];
    if (f) void loadFile(f);
    input.value = '';
  });

  const drop = $('drop');
  drop.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      input.click();
    }
  });
  // Drop anywhere on the page.
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
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    depth = 0;
    document.body.classList.remove('dragging');
    const f = e.dataTransfer?.files?.[0];
    if (f) void loadFile(f);
  });

  $('password-form').addEventListener('submit', (e) => {
    e.preventDefault();
    if (pending) void load(pending.name, pending.data, $<HTMLInputElement>('password').value);
  });

  for (const id of ['opt-template', 'opt-date', 'opt-decimal']) $(id).addEventListener('change', run);
  $('opt-currency').addEventListener('input', run);
  $('search').addEventListener('input', renderRows);

  const menu = document.querySelector<HTMLDetailsElement>('.menu')!;
  document.querySelectorAll<HTMLButtonElement>('[data-export]').forEach((b) =>
    b.addEventListener('click', () => {
      exportAs(b.dataset.export!);
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
    result = undefined;
    lines = [];
    showResults(false);
  });

  const dialog = $<HTMLDialogElement>('template-dialog');
  $('save-template').addEventListener('click', () => dialog.showModal());
  dialog.addEventListener('close', () => {
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

async function loadSamples() {
  try {
    const res = await fetch('./samples/index.json');
    const list = (await res.json()) as { file: string; country: string; currency: string; title: string; description: string }[];
    $('sample-list').replaceChildren(
      ...list.map((s) => {
        const [bank, style] = s.title.split(/\s*\((.*)\)\s*/);
        const btn = h(
          'button',
          { type: 'button', className: 'index-row' },
          h('span', { className: 'index-cc mono' }, s.country),
          h('span', { className: 'index-name' }, bank ?? s.title, style ? h('span', { className: 'index-style' }, style) : null),
          h('span', { className: 'index-desc' }, s.description),
          h('span', { className: 'index-cur mono' }, s.currency),
          h('span', { className: 'index-go', ariaHidden: 'true' }, '→'),
        );
        btn.addEventListener('click', async () => {
          setStatus('Opening sample…');
          const data = new Uint8Array(await (await fetch(`./samples/${s.file}`)).arrayBuffer());
          await load(`${bank ?? s.title}.pdf`, data);
        });
        return h('li', {}, btn);
      }),
    );
  } catch {
    // Samples are optional.
  }
}

init();
