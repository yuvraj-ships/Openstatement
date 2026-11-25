<div align="center">

<img src="apps/web/public/favicon.svg" width="64" height="64" alt="" />

# OpenStatement

**Turn any bank statement PDF into clean CSV, Excel, OFX or QIF — 100% in your browser.**

Any bank · any country · free forever · your statement never leaves your device

[**Try it →**](https://yuvrajsinh1812.github.io/Openstatement/) · [Use the library](#use-it-as-a-library) · [Add your bank](CONTRIBUTING.md#add-your-bank-in-5-minutes)

[![CI](https://github.com/Yuvrajsinh1812/Openstatement/actions/workflows/ci.yml/badge.svg)](https://github.com/Yuvrajsinh1812/Openstatement/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-teal.svg)](LICENSE)

</div>

---

## Why

Banks hand you PDFs. Budgeting apps, spreadsheets and accountants want data. The tools that convert one into the other are usually **paid** and usually make you **upload your bank statement to someone's server**.

OpenStatement does it for free, on your own device. The web app ships with a Content-Security-Policy that **blocks all connections to other servers**, so it technically *cannot* upload your file.

## Features

- 🌍 **Works with any bank** — no per-bank code needed. It finds the transaction table on its own.
- 📅 **Understands world formats** — `DD/MM/YYYY`, `MM/DD/YYYY`, `YYYY-MM-DD`, `05 Jan 2026`, `5. Dez.`, `1,234.56`, `1.234,56`, `1 234,56`, `12,34,567.89`, currencies with no decimals (JPY, KRW)…
- 🗣️ **Multilingual column headers** — English, German, French, Spanish, Italian, Portuguese, Dutch.
- ✅ **Self-checking** — uses each row's running balance to verify money in vs money out, and auto-fixes swapped columns.
- 🧩 **Handles messy layouts** — multi-line descriptions, multi-page statements, newest-first order, rows without dates, value dates, `DR`/`CR` markers, `(brackets)` and trailing minus signs.
- 🔑 **Password-protected PDFs** — unlock them locally (many banks send these).
- 📤 **Exports** — CSV, Excel-friendly CSV, **OFX** and **QIF** (GnuCash, YNAB, Actual Budget, Firefly III, Quicken, MoneyMoney…), JSON.
- 🏷️ **Spending categories** — simple, transparent keyword rules anyone can extend.
- 🧠 **Learns banks from the community** — fix the columns once in the app, export a tiny JSON *template*, and send a pull request.

## How it works

```
PDF ──pdf.js──▶ positioned text ──▶ find rows (date + amounts) ──▶ detect formats & columns
                                                                         │
       CSV / OFX / QIF / JSON ◀── categorize ◀── verify with running balance ◀┘
```

1. **Extract** text with its x/y position using [pdf.js](https://github.com/mozilla/pdf.js).
2. **Find transaction rows**: lines that start with a date and contain at least one amount.
3. **Detect formats**: day/month order from impossible values (`25/02` must be DMY) or, if every day is ≤ 12, from which order reads chronologically. Decimal separator by majority vote.
4. **Map columns** from the header row (multilingual keywords), or — with no header — by clustering the positions of numbers on the page.
5. **Verify** every amount against the change in running balance, flipping signs where the balance proves the columns were swapped.

## Use it as a library

```bash
npm install openstatement pdfjs-dist
```

```ts
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'; // in browsers: 'pdfjs-dist'
import { readFile, writeFile } from 'node:fs/promises';
import { parsePdf, toCSV } from 'openstatement';

const result = await parsePdf(await readFile('statement.pdf'), { pdfjs });

console.log(result.transactions[0]);
// { date: '2026-01-02', description: 'ACME CORP PAYROLL', amount: 2500, balance: 4350.25, category: 'Income', page: 1 }

console.log(result.meta.confidence, result.meta.warnings);
await writeFile('statement.csv', toCSV(result.transactions));
```

| Option | Description |
| --- | --- |
| `password` | Password for protected PDFs. Throws `PdfPasswordError` if missing/wrong. |
| `dateOrder` | Force `'DMY'`, `'MDY'` or `'YMD'`. |
| `numberFormat` | Force `{ decimal: ',' }` or `{ decimal: '.' }`. |
| `currency` | ISO code, e.g. `'EUR'`. Detected automatically otherwise. |
| `template` | A template object, a built-in template id, or `false` to disable auto-matching. |
| `columns` | Override the detected column layout. |
| `categorize` | Set `false` to skip categories. |

Already have the text lines (e.g. from another PDF library)? Use `parseLines(lines, options)` directly.

## Run it locally

```bash
git clone https://github.com/Yuvrajsinh1812/Openstatement.git
cd Openstatement
npm install
npm run dev        # web app at http://localhost:5173
npm test           # unit + end-to-end tests
npm run build      # library (packages/core/dist) + website (apps/web/dist)
```

## Project structure

```
packages/core/          the `openstatement` npm library (no runtime dependencies)
  src/parse.ts          table detection, column mapping, balance verification
  src/tokens.ts         dates, amounts and currencies in many formats
  src/headers.ts        multilingual column-header keywords
  src/categorize.ts     spending categories
  src/export.ts         CSV, OFX, QIF, JSON, template export
  src/templates/        region presets and community bank templates
  test/fixtures/        synthetic statements rendered to real PDFs for tests
apps/web/               the static web app (Vite, no framework, no backend)
```

## Testing without real statements

Nobody should commit a real bank statement. The test suite **generates PDFs from fictional banks** in several regional styles (US, UK, German, Indian, Singaporean, Japanese) and checks every parsed date, amount and balance. The same PDFs power the "Try a sample" buttons in the app. Run `npm run samples` to regenerate them.

## Roadmap

- [ ] More languages for column headers and months (Polish, Turkish, Indonesian, Arabic…)
- [ ] Bank templates contributed by the community
- [ ] Credit-card statements (statement date vs posting date, minimum payment sections)
- [ ] Real `.xlsx` export
- [ ] Offline support (installable PWA)
- [ ] CLI: `npx openstatement statement.pdf --csv`
- [ ] OCR for scanned statements (local, with Tesseract.js)

## Contributing

Contributions of every size are welcome — especially **adding your bank** or **your language**. See [CONTRIBUTING.md](CONTRIBUTING.md). Look for issues labelled [`good first issue`](https://github.com/Yuvrajsinh1812/Openstatement/labels/good%20first%20issue).

## License

[MIT](LICENSE). Not affiliated with any bank. Always double-check exported data before relying on it.
