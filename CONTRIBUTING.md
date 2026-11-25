# Contributing to OpenStatement

Thanks for helping! OpenStatement gets better every time someone teaches it a new bank, language or format.

## ⚠️ The one rule: never share a real statement

Do **not** attach real bank statements to issues or pull requests, and never commit them, not even "redacted" ones. PDFs often hide data you can't see (metadata, text under black boxes, embedded fonts).

Instead:

- describe the layout in words, or
- share a **bank template** (it contains only column names and positions), or
- add a **synthetic sample** to `packages/core/test/fixtures/samples.ts` that copies the layout with made-up data.

## Add your bank in 5 minutes

1. Open the web app and load your statement. It stays on your computer.
2. If anything looks wrong, open **"Something wrong? Adjust detection"** and fix the date format, the number format or the column meanings.
3. Click **Save bank template…**, enter the bank name, the country code and a phrase that appears on every statement from this bank (for example the bank's legal name).
4. Open the downloaded `.json` file and check it. It should contain only the layout.
5. Put it in `packages/core/src/templates/banks/<country-code>/<id>.json`, import it in `packages/core/src/templates/index.ts` and add it to the `templates` list.
6. Open a pull request. It helps a lot if you also add a synthetic sample with the same layout (see below).

### Template format

```jsonc
{
  "id": "gb-example-bank",           // <country>-<bank>, lower case
  "name": "Example Bank",
  "country": "GB",                    // ISO 3166-1 alpha-2
  "detect": { "contains": ["Example Bank plc"] }, // auto-apply when the statement contains ALL of these
  "dateOrder": "DMY",                 // DMY | MDY | YMD
  "numberFormat": { "decimal": "." }, // "." or ","
  "currency": "GBP",
  "headers": {                        // extra header labels per column role
    "debit": ["Money out"],
    "credit": ["Money in"]
  },
  "columns": [                        // OR fixed x positions (in PDF points), for statements with no header row
    { "role": "date", "x0": 40, "x1": 95 }
  ],
  "skip": ["^Interest rate"]          // regexes for lines to ignore
}
```

Column roles: `date`, `valueDate`, `description`, `reference`, `debit`, `credit`, `amount`, `balance`, `sign`, `ignore`.

## Add a language

- **Column headers:** add words to the rules in `packages/core/src/headers.ts`, and a test case in `test/tokens.test.ts`.
- **Month names:** add them to `MONTH_NAMES` in `packages/core/src/tokens.ts`.
- **Opening/closing balance phrases:** `OPENING` / `CLOSING` in `packages/core/src/parse.ts`.
- **Categories:** shops and services from your country in `packages/core/src/categorize.ts`.

## Add a synthetic sample (best way to report a layout bug)

`packages/core/test/fixtures/samples.ts` describes fictional statements that are rendered to real PDFs during the tests. Copy one, change the columns, date format and number format to match the layout you're fixing, and use made-up names and amounts. The end-to-end test will check every row automatically. Run `npm run samples` to add it to the web app's "Try a sample" list too.

## Development

```bash
npm install
npm run dev         # web app with hot reload
npm test            # all tests
npm run typecheck
npm run build
```

- Keep the core library free of runtime dependencies. `pdfjs-dist` is passed in by the caller.
- Every bug fix should come with a test.
- Keep the web app working offline and without any network requests. The production build enforces this with a Content-Security-Policy.

## Pull requests

- One topic per PR, with a short description of what changed and why.
- `npm test` and `npm run typecheck` must pass. CI runs both.
- Be kind. See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
