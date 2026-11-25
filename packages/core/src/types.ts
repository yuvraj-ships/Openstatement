/** A run of text on one line of a PDF page, with its horizontal position (PDF points). */
export interface TextCell {
  text: string;
  x: number;
  width: number;
}

/** One visual line of text on a page. Lines are ordered top-to-bottom, cells left-to-right. */
export interface TextLine {
  page: number;
  /** Vertical position (distance from the top of the page, in points). */
  y: number;
  cells: TextCell[];
}

/** Order of day / month / year in numeric dates like 03/04/2026. */
export type DateOrder = 'DMY' | 'MDY' | 'YMD';

export interface NumberFormat {
  /** Decimal separator, e.g. "." in 1,234.56 or "," in 1.234,56 */
  decimal: '.' | ',';
}

export type ColumnRole =
  | 'date'
  | 'valueDate'
  | 'description'
  | 'reference'
  | 'debit'
  | 'credit'
  | 'amount'
  | 'balance'
  | 'sign'
  | 'ignore';

export interface Column {
  index: number;
  role: ColumnRole;
  /** Header text, when the statement has a header row. */
  label?: string;
  x0: number;
  x1: number;
  /** Whether this column holds numbers (affects how cells are matched to it). */
  numeric: boolean;
  source: 'header' | 'inferred' | 'template' | 'user';
}

export interface Transaction {
  /** ISO date, YYYY-MM-DD */
  date: string;
  valueDate?: string;
  description: string;
  /** Signed amount: positive = money in, negative = money out. */
  amount: number;
  balance?: number;
  reference?: string;
  category?: string;
  page: number;
  /** Which statement this came from, when several statements are merged. */
  source?: string;
}

/**
 * A bank template is a small, shareable JSON file that gives the parser hints for one bank's layout.
 * Everything is optional: auto-detection fills in whatever a template leaves out.
 */
export interface Template {
  id: string;
  name: string;
  /** ISO 3166-1 alpha-2 country code, or "XX" for region-agnostic presets. */
  country: string;
  /** The template is applied automatically when the statement text contains ALL of these strings. */
  detect?: { contains?: string[] };
  dateOrder?: DateOrder;
  numberFormat?: NumberFormat;
  currency?: string;
  /** Extra header labels for each role, for banks that use unusual column names. */
  headers?: Partial<Record<ColumnRole, string[]>>;
  /** Fixed column positions, for statements without a header row. */
  columns?: { role: ColumnRole; x0: number; x1: number; numeric?: boolean }[];
  /** Regular expressions (case-insensitive). Lines matching any of them are ignored. */
  skip?: string[];
}

export interface ParseOptions {
  dateOrder?: DateOrder;
  numberFormat?: NumberFormat;
  currency?: string;
  /** A template object, or the id of a built-in template. Default: auto-match built-in templates. */
  template?: Template | string | false;
  /** Replace the detected column layout (e.g. after the user re-mapped columns in a UI). */
  columns?: Column[];
  /** Assign spending categories to transactions. Default: true. */
  categorize?: boolean;
}

export interface BalanceCheck {
  /** Rows whose running balance could be checked against the previous row. */
  checked: number;
  /** Rows where previous balance + amount = balance. */
  matched: number;
}

export interface ParseResult {
  transactions: Transaction[];
  meta: {
    dateOrder: DateOrder;
    numberFormat: NumberFormat;
    currency?: string;
    template?: string;
    columns: Column[];
    openingBalance?: number;
    closingBalance?: number;
    balanceCheck: BalanceCheck;
    /** 0–1. How sure the parser is that money in / money out is correct. */
    confidence: number;
    warnings: string[];
  };
}
