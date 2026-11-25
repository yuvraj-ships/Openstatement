# openstatement

Parse bank statement PDFs from **any bank, in any country** into structured transactions, then export CSV, OFX, QIF or JSON. Runs in browsers and Node. No runtime dependencies, and no network access.

```bash
npm install openstatement pdfjs-dist
```

```ts
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'; // browsers: import * as pdfjs from 'pdfjs-dist'
import { parsePdf, toCSV, toOFX } from 'openstatement';

const result = await parsePdf(pdfBytes, { pdfjs, password: optionalPassword });

result.transactions; // [{ date: '2026-01-02', description: '…', amount: -12.5, balance: 980.1, category: 'Dining', page: 1 }]
result.meta;         // { dateOrder, numberFormat, currency, columns, balanceCheck, confidence, warnings }

toCSV(result.transactions);
toOFX(result);
```

- Amounts are signed: positive means money in, negative means money out.
- Dates are ISO `YYYY-MM-DD`, sorted oldest first.
- `meta.confidence` is 1 when every running balance adds up.

Full documentation, the web app and contribution guide: see the [project README](https://github.com/Yuvrajsinh1812/Openstatement#readme).

MIT licensed.
