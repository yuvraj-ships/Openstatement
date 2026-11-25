/**
 * Synthetic bank statements for tests and the web demo.
 *
 * Every bank, person and number here is made up. We generate real PDFs from these specs so the
 * parser is tested end-to-end (PDF â†’ text â†’ transactions) without anyone's real statement.
 * Each sample mimics a different regional style: date order, number format, column layout,
 * debit/credit vs signed amounts, multi-line descriptions, multiple pages, newest-first order.
 */
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

export interface SampleTx {
  date: string; // ISO
  description: string;
  amount: number; // signed: + money in, - money out
  /** Second description line printed under the first. */
  more?: string;
  ref?: string;
}

interface Col {
  header: string;
  x: number;
  width: number;
  align: 'left' | 'right';
  cell: (t: SampleTx, balance: number) => string;
}

export interface Sample {
  id: string;
  /** ISO country code of the style this sample imitates. */
  country: string;
  title: string;
  description: string;
  currency: string;
  opening: number;
  txs: SampleTx[];
  preamble: string[];
  columns: Col[];
  /** Cells for the opening-balance line, or undefined to omit it. */
  openingLine?: (opening: number) => string[];
  closingLine?: (closing: number) => string[];
  newestFirst?: boolean;
  noHeader?: boolean;
  rowsPerPage?: number;
  landscape?: boolean;
  /** Samples with the same group are consecutive statements of one account. */
  group?: string;
}

// --- formatting helpers ----------------------------------------------------

function num(n: number, decimal: '.' | ',', group: string, decimals = 2): string {
  const [int, frac] = Math.abs(n).toFixed(decimals).split('.');
  const grouped = int!.replace(/\B(?=(\d{3})+(?!\d))/g, group);
  return decimals ? `${grouped}${decimal}${frac}` : grouped;
}
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const parts = (iso: string) => iso.split('-') as [string, string, string];
const mdy = (iso: string) => {
  const [y, m, d] = parts(iso);
  return `${m}/${d}/${y}`;
};
const dMonY = (iso: string) => {
  const [y, m, d] = parts(iso);
  return `${d} ${MON[Number(m) - 1]} ${y}`;
};
const dotted = (iso: string) => {
  const [y, m, d] = parts(iso);
  return `${d}.${m}.${y}`;
};
const dmyShort = (iso: string) => {
  const [y, m, d] = parts(iso);
  return `${d}/${m}/${y.slice(2)}`;
};
const slashYmd = (iso: string) => iso.replace(/-/g, '/');
const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

// --- samples ---------------------------------------------------------------

const us: Sample = {
  id: 'us-signed-amounts',
  country: 'US',
  title: 'Northwind Bank (US style)',
  description: 'MM/DD/YYYY dates, one signed Amount column, running balance',
  currency: 'USD',
  opening: 1850.25,
  preamble: ['NORTHWIND BANK', 'Everyday Checking â€” Account ending 4821', 'Statement period: 01/01/2026 to 01/31/2026', 'All amounts in USD'],
  columns: [
    { header: 'Date', x: 40, width: 60, align: 'left', cell: (t) => mdy(t.date) },
    { header: 'Description', x: 115, width: 270, align: 'left', cell: (t) => t.description },
    { header: 'Amount', x: 395, width: 75, align: 'right', cell: (t) => (t.amount < 0 ? '-' : '') + num(t.amount, '.', ',') },
    { header: 'Balance', x: 480, width: 75, align: 'right', cell: (_t, b) => num(b, '.', ',') },
  ],
  openingLine: (o) => ['', 'Beginning balance', '', num(o, '.', ',')],
  closingLine: (c) => ['', 'Ending balance', '', num(c, '.', ',')],
  txs: [
    { date: '2026-01-02', description: 'ACME CORP PAYROLL DIRECT DEP', amount: 2500 },
    { date: '2026-01-03', description: 'STARBUCKS STORE 1184', amount: -5.75 },
    { date: '2026-01-05', description: 'ONLINE TRANSFER TO LANDLORD RENT', amount: -1200 },
    { date: '2026-01-07', description: 'AMAZON MKTPLACE PMTS', amount: -64.99, more: 'AMZN.COM/BILL WA' },
    { date: '2026-01-09', description: 'UBER TRIP', amount: -18.4 },
    { date: '2026-01-12', description: 'NETFLIX.COM', amount: -15.49 },
    { date: '2026-01-15', description: 'ZELLE FROM JORDAN LEE', amount: 40 },
    { date: '2026-01-20', description: 'CITY ELECTRIC UTILITY', amount: -82.1 },
    { date: '2026-01-28', description: 'ATM WITHDRAWAL 5TH AVE', amount: -100 },
  ],
};

const uk: Sample = {
  id: 'uk-paid-in-out',
  country: 'GB',
  title: 'Harbour Bank (UK style)',
  description: 'DD Mon YYYY dates, Paid out / Paid in columns, balance brought forward',
  currency: 'GBP',
  opening: 1000,
  preamble: ['Harbour Bank plc', 'Current Account statement', 'Sort code 00-00-00   Account 00000000', 'Currency: GBP'],
  columns: [
    { header: 'Date', x: 40, width: 65, align: 'left', cell: (t) => dMonY(t.date) },
    { header: 'Description', x: 115, width: 230, align: 'left', cell: (t) => t.description },
    { header: 'Paid out', x: 345, width: 65, align: 'right', cell: (t) => (t.amount < 0 ? num(t.amount, '.', ',') : '') },
    { header: 'Paid in', x: 415, width: 65, align: 'right', cell: (t) => (t.amount > 0 ? num(t.amount, '.', ',') : '') },
    { header: 'Balance', x: 485, width: 70, align: 'right', cell: (_t, b) => num(b, '.', ',') },
  ],
  openingLine: (o) => ['01 Jan 2026', 'Balance brought forward', '', '', num(o, '.', ',')],
  txs: [
    { date: '2026-01-02', description: 'TESCO STORES 2231', amount: -42.18 },
    { date: '2026-01-04', description: 'FASTER PAYMENT FROM S PATEL', amount: 250, more: 'REF FLAT SHARE' },
    { date: '2026-01-06', description: 'TFL TRAVEL CH', amount: -7.4 },
    { date: '2026-01-10', description: 'SALARY NORTHERN WIDGETS LTD', amount: 2140.55 },
    { date: '2026-01-11', description: 'DIRECT DEBIT COUNCIL TAX', amount: -156 },
    { date: '2026-01-18', description: 'DELIVEROO', amount: -23.9 },
    { date: '2026-01-25', description: 'BT GROUP BROADBAND', amount: -35 },
  ],
};

const de: Sample = {
  id: 'de-comma-decimal',
  country: 'DE',
  title: 'Bergwerk Bank (German style)',
  description: 'DD.MM.YYYY dates, value date, 1.234,56 amounts, German headers',
  currency: 'EUR',
  opening: 3200.4,
  preamble: ['Bergwerk Bank AG', 'Kontoauszug Nr. 1/2026', 'IBAN DE00 0000 0000 0000 0000 00', 'WÃ¤hrung: EUR'],
  columns: [
    { header: 'Buchungstag', x: 40, width: 60, align: 'left', cell: (t) => dotted(t.date) },
    { header: 'Valuta', x: 105, width: 55, align: 'left', cell: (t) => dotted(addDays(t.date, 1)) },
    { header: 'Verwendungszweck', x: 165, width: 230, align: 'left', cell: (t) => t.description },
    { header: 'Betrag (EUR)', x: 400, width: 75, align: 'right', cell: (t) => (t.amount < 0 ? '-' : '+') + num(t.amount, ',', '.') },
    { header: 'Saldo (EUR)', x: 480, width: 75, align: 'right', cell: (_t, b) => num(b, ',', '.') },
  ],
  openingLine: (o) => ['', '', 'Alter Kontostand', '', num(o, ',', '.')],
  closingLine: (c) => ['', '', 'Neuer Kontostand', '', num(c, ',', '.')],
  txs: [
    { date: '2026-01-02', description: 'REWE Markt GmbH', amount: -54.32 },
    { date: '2026-01-05', description: 'Miete Januar Hausverwaltung', amount: -1150 },
    { date: '2026-01-08', description: 'Gehalt Musterfirma GmbH', amount: 3480.12, more: 'Lohn/Gehalt 01/2026' },
    { date: '2026-01-14', description: 'Deutsche Bahn Ticket', amount: -89.9 },
    { date: '2026-01-21', description: 'Spotify AB', amount: -10.99 },
    { date: '2026-01-27', description: 'Apotheke am Markt', amount: -18.75 },
  ],
};

function indiaTxs(): SampleTx[] {
  const shops = [
    ['UPI/DMART AVENUE/9876500001/Groceries', -1840.5],
    ['UPI/SWIGGY/9876500002/Food order', -412],
    ['POS 4111XXXXXXXX1111 INDIAN OIL', -2000],
    ['UPI/ZOMATO/9876500003/Dinner', -655.75],
    ['NEFT CR-ACME SOFTWARE PVT LTD-SALARY', 85000],
    ['ATM WDL SAHYADRI BANK ATM PUNE', -5000],
    ['UPI/AIRTEL/9876500004/Recharge', -299],
    ['IMPS-RAHUL S-SHARED RENT', 12000],
    ['ACH D- LIC OF INDIA PREMIUM', -3450],
    ['UPI/BLINKIT/9876500005/Groceries', -723.4],
  ] as const;
  const out: SampleTx[] = [];
  let day = 0;
  for (let i = 0; i < 36; i++) {
    const [desc, amount] = shops[i % shops.length]!;
    if (i % 2 === 0) day++;
    const tx: SampleTx = {
      date: addDays('2026-01-01', day),
      description: desc,
      amount: amount + (i >= 10 && amount < 0 ? -(i % 7) * 3 : 0),
      ref: `000041${String(234500 + i * 7)}`,
    };
    if (i % 6 === 4) tx.more = 'TXN ID 61' + String(1000000 + i * 13);
    out.push(tx);
  }
  return out;
}

const india: Sample = {
  id: 'in-withdrawal-deposit',
  country: 'IN',
  title: 'Sahyadri Bank (India style)',
  description: 'DD/MM/YY dates, Withdrawal / Deposit / Closing Balance, 2 pages, multi-line narration',
  currency: 'INR',
  opening: 25000,
  rowsPerPage: 22,
  preamble: ['SAHYADRI BANK LTD', 'Statement of account', 'Account No : XXXXXXXX1234   Currency : INR', 'Opening Balance 25,000.00'],
  landscape: true,
  columns: [
    { header: 'Date', x: 30, width: 45, align: 'left', cell: (t) => dmyShort(t.date) },
    { header: 'Narration', x: 85, width: 230, align: 'left', cell: (t) => t.description },
    { header: 'Chq./Ref.No.', x: 320, width: 90, align: 'left', cell: (t) => t.ref ?? '' },
    { header: 'Value Dt', x: 420, width: 45, align: 'left', cell: (t) => dmyShort(t.date) },
    { header: 'Withdrawal Amt.', x: 480, width: 80, align: 'right', cell: (t) => (t.amount < 0 ? num(t.amount, '.', ',') : '') },
    { header: 'Deposit Amt.', x: 570, width: 80, align: 'right', cell: (t) => (t.amount > 0 ? num(t.amount, '.', ',') : '') },
    { header: 'Closing Balance', x: 660, width: 100, align: 'right', cell: (_t, b) => num(b, '.', ',') },
  ],
  closingLine: (c) => ['', 'Closing Balance', '', '', '', '', num(c, '.', ',')],
  txs: indiaTxs(),
};

const newestFirst: Sample = {
  id: 'iso-newest-first-no-header',
  country: 'SG',
  title: 'Coral Bank (newest first, no header)',
  description: 'YYYY-MM-DD dates, no header row, unsigned amounts, newest transactions first',
  currency: 'SGD',
  opening: 5000,
  newestFirst: true,
  noHeader: true,
  preamble: ['Coral Bank', 'Transaction history (SGD)'],
  columns: [
    { header: '', x: 40, width: 60, align: 'left', cell: (t) => t.date },
    { header: '', x: 115, width: 270, align: 'left', cell: (t) => t.description },
    { header: '', x: 400, width: 70, align: 'right', cell: (t) => num(t.amount, '.', ',') },
    { header: '', x: 480, width: 75, align: 'right', cell: (_t, b) => num(b, '.', ',') },
  ],
  openingLine: (o) => ['2026-01-01', 'Opening balance', '', num(o, '.', ',')],
  txs: [
    { date: '2026-01-03', description: 'GRAB RIDE', amount: -14.2 },
    { date: '2026-01-06', description: 'NTUC FAIRPRICE', amount: -63.05 },
    { date: '2026-01-09', description: 'PAYNOW FROM WEI MING', amount: 120 },
    { date: '2026-01-15', description: 'SINGTEL MOBILE BILL', amount: -45 },
    { date: '2026-01-25', description: 'SALARY ORCHID PTE LTD', amount: 4800 },
  ],
};

const japan: Sample = {
  id: 'jp-no-decimals',
  country: 'JP',
  title: 'Sakura Trust (no decimals, JPY)',
  description: 'YYYY/MM/DD dates, whole-number yen amounts',
  currency: 'JPY',
  opening: 152000,
  preamble: ['Sakura Trust Bank', 'Ordinary deposit account', 'Currency JPY'],
  columns: [
    { header: 'Date', x: 40, width: 60, align: 'left', cell: (t) => slashYmd(t.date) },
    { header: 'Description', x: 115, width: 230, align: 'left', cell: (t) => t.description },
    { header: 'Withdrawals', x: 345, width: 65, align: 'right', cell: (t) => (t.amount < 0 ? num(t.amount, '.', ',', 0) : '') },
    { header: 'Deposits', x: 415, width: 65, align: 'right', cell: (t) => (t.amount > 0 ? num(t.amount, '.', ',', 0) : '') },
    { header: 'Balance', x: 485, width: 70, align: 'right', cell: (_t, b) => num(b, '.', ',', 0) },
  ],
  txs: [
    { date: '2026-01-05', description: 'CONVENIENCE STORE', amount: -864 },
    { date: '2026-01-10', description: 'ELECTRIC POWER CO', amount: -7420 },
    { date: '2026-01-25', description: 'SALARY KAWASAKI WORKS', amount: 285000 },
    { date: '2026-01-27', description: 'RENT TRANSFER', amount: -98000 },
  ],
};

// --- three consecutive monthly statements (for merging & insights) -----------

/** Jan–Mar 2026 for one account. Netflix, Spotify, gym and rent repeat monthly; shopping varies. */
export const quarterTxs: SampleTx[] = [
  { date: '2026-01-02', description: 'ACME CORP PAYROLL DIRECT DEP', amount: 2500 },
  { date: '2026-01-05', description: 'ONLINE TRANSFER TO LANDLORD RENT', amount: -1200 },
  { date: '2026-01-08', description: 'WHOLE FOODS MARKET #1021', amount: -84.12 },
  { date: '2026-01-12', description: 'NETFLIX.COM', amount: -15.49 },
  { date: '2026-01-15', description: 'IRONWORKS GYM MEMBERSHIP', amount: -39.0 },
  { date: '2026-01-18', description: 'SPOTIFY USA', amount: -10.99 },
  { date: '2026-01-21', description: 'UBER TRIP', amount: -18.4 },
  { date: '2026-01-27', description: 'CITY ELECTRIC UTILITY', amount: -82.1 },
  { date: '2026-02-02', description: 'ACME CORP PAYROLL DIRECT DEP', amount: 2500 },
  { date: '2026-02-05', description: 'ONLINE TRANSFER TO LANDLORD RENT', amount: -1200 },
  { date: '2026-02-09', description: 'WHOLE FOODS MARKET #1021', amount: -131.4 },
  { date: '2026-02-12', description: 'NETFLIX.COM', amount: -15.49 },
  { date: '2026-02-14', description: 'BISTRO LUNA VALENTINES', amount: -96.5 },
  { date: '2026-02-15', description: 'IRONWORKS GYM MEMBERSHIP', amount: -39.0 },
  { date: '2026-02-18', description: 'SPOTIFY USA', amount: -10.99 },
  { date: '2026-02-26', description: 'AMAZON MKTPLACE PMTS', amount: -64.99 },
  { date: '2026-02-27', description: 'CITY ELECTRIC UTILITY', amount: -91.35 },
  { date: '2026-03-02', description: 'ACME CORP PAYROLL DIRECT DEP', amount: 2500 },
  { date: '2026-03-05', description: 'ONLINE TRANSFER TO LANDLORD RENT', amount: -1200 },
  { date: '2026-03-07', description: 'ZELLE FROM JORDAN LEE', amount: 60 },
  { date: '2026-03-10', description: 'WHOLE FOODS MARKET #1021', amount: -57.75 },
  { date: '2026-03-12', description: 'NETFLIX.COM', amount: -15.49 },
  { date: '2026-03-15', description: 'IRONWORKS GYM MEMBERSHIP', amount: -39.0 },
  { date: '2026-03-18', description: 'SPOTIFY USA', amount: -10.99 },
  { date: '2026-03-22', description: 'UBER TRIP', amount: -31.75 },
  { date: '2026-03-27', description: 'CITY ELECTRIC UTILITY', amount: -76.8 },
];
export const quarterOpening = 1850.25;

function quarterSample(id: string, title: string, from: string, to: string): Sample {
  let opening = quarterOpening;
  for (const t of quarterTxs) if (t.date < from) opening = Math.round((opening + t.amount) * 100) / 100;
  return {
    ...us,
    id,
    group: 'us-quarter',
    title,
    description: 'One of three monthly statements — load them together to merge',
    preamble: ['NORTHWIND BANK', 'Everyday Checking — Account ending 4821', `Statement period: ${mdy(from)} to ${mdy(to)}`, 'All amounts in USD'],
    opening,
    txs: quarterTxs.filter((t) => t.date >= from && t.date <= to),
  };
}

/** The March download starts on Feb 26, so two February rows appear twice — the merge removes them. */
export const quarter: Sample[] = [
  quarterSample('us-2026-01', 'Northwind Bank (January 2026)', '2026-01-01', '2026-01-31'),
  quarterSample('us-2026-02', 'Northwind Bank (February 2026)', '2026-02-01', '2026-02-28'),
  quarterSample('us-2026-03', 'Northwind Bank (March 2026)', '2026-02-26', '2026-03-31'),
];

export const samples: Sample[] = [us, uk, de, india, newestFirst, japan, ...quarter];

// --- rendering -------------------------------------------------------------

/** Expected parse output, oldest first. */
export function expected(s: Sample): { date: string; amount: number; balance: number; description: string; more?: string }[] {
  let bal = s.opening;
  return s.txs.map((t) => {
    bal = Math.round((bal + t.amount) * 100) / 100;
    return { date: t.date, amount: t.amount, balance: bal, description: t.description, more: t.more };
  });
}

export async function renderSamplePdf(s: Sample): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${s.title} â€” synthetic sample statement`);
  pdf.setProducer('openstatement sample generator');
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const size = 8.5;
  const W = s.landscape ? 842 : 595;
  const H = s.landscape ? 595 : 842;

  const exp = expected(s);
  type Printable = { cells: string[]; more?: string };
  const body: Printable[] = s.txs.map((t, i) => ({ cells: s.columns.map((c) => c.cell(t, exp[i]!.balance)), more: t.more }));
  if (s.openingLine) body.unshift({ cells: s.openingLine(s.opening) });
  if (s.newestFirst) body.reverse();

  const perPage = s.rowsPerPage ?? 60;
  const pages = Math.max(1, Math.ceil(body.length / perPage));
  const descCol = s.columns.findIndex((c) => /desc|narration|zweck/i.test(c.header)) >= 0
    ? s.columns.findIndex((c) => /desc|narration|zweck/i.test(c.header))
    : 1;

  const drawCell = (page: ReturnType<typeof pdf.addPage>, text: string, col: Col, y: number, f = font) => {
    if (!text) return;
    const w = f.widthOfTextAtSize(text, size);
    const x = col.align === 'right' ? col.x + col.width - w : col.x;
    page.drawText(text, { x, y, size, font: f, color: rgb(0.1, 0.1, 0.12) });
  };

  for (let p = 0; p < pages; p++) {
    const page = pdf.addPage([W, H]);
    let y = H - 50;
    s.preamble.forEach((line, i) => {
      page.drawText(line, { x: 40, y, size: i === 0 ? 14 : 9, font: i === 0 ? bold : font });
      y -= i === 0 ? 20 : 13;
    });
    y -= 12;
    if (!s.noHeader) {
      s.columns.forEach((c) => drawCell(page, c.header, c, y, bold));
      y -= 16;
    }
    for (const row of body.slice(p * perPage, (p + 1) * perPage)) {
      row.cells.forEach((text, i) => drawCell(page, text, s.columns[i]!, y));
      y -= 11;
      if (row.more) {
        drawCell(page, row.more, s.columns[descCol]!, y);
        y -= 11;
      }
      y -= 3;
    }
    if (p === pages - 1 && s.closingLine) {
      y -= 8;
      const closing = exp[exp.length - 1]?.balance ?? s.opening;
      s.closingLine(closing).forEach((text, i) => drawCell(page, text, s.columns[i]!, y, bold));
    }
    page.drawText(`Page ${p + 1} of ${pages}`, { x: W / 2 - 25, y: 30, size: 8, font });
    page.drawText('This is a synthetic sample statement. All names and numbers are fictional.', { x: 40, y: 18, size: 7, font });
  }
  return pdf.save();
}
