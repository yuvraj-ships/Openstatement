import type { ColumnRole } from './types.js';
import { normalize } from './tokens.js';

/**
 * Column header words in several languages. Order matters: the first rule that matches wins,
 * so "Withdrawal Amount" is a debit column (not a generic amount) and "Value Date" is not the
 * booking date. Contributions for more languages are very welcome.
 */
const RULES: [ColumnRole, RegExp][] = [
  ['valueDate', /\b(value\s*(date|dt)|valuta(datum)?|wertstellung|fecha\s*valor|date\s*(de\s*)?valeur|data\s*valuta)\b/],
  ['balance', /\b(balance|bal|saldo|solde|kontostand|balans)\b/],
  ['sign', /^(dr\s*\/\s*cr|cr\s*\/\s*dr|d\s*\/\s*c|c\s*\/\s*d|s\s*\/\s*h|\+\s*\/\s*-)$/],
  [
    'debit',
    /\b(debits?|withdrawals?|withdrawn|paid\s*out|money\s*out|out|dr|soll|belastung|lastschrift|ausgang|cargos?|debe|debito|retiros?|addebiti|uscite|af|payments?|spent|charges)\b/,
  ],
  [
    'credit',
    /\b(credits?|deposits?|paid\s*in|money\s*in|in|cr|haben|gutschrift|eingang|abonos?|haber|credito|depositos?|accrediti|entrate|bij|received)\b/,
  ],
  ['reference', /\b(ref(erence)?(\s*(no|number|#))?|chq(\s*no)?|cheque(\s*no)?|check\s*(no|number|#)|referenz|referencia|riferimento)\b/],
  [
    'date',
    /\b(date|dt|datum|fecha|data|buchungstag|buchungsdatum|buchung|posted|posting|post|txn|tran|trans|transaction\s*date)\b/,
  ],
  ['amount', /\b(amount|amt|betrag|importe|montant|importo|valor|bedrag|umsatz|sum)\b/],
  [
    'description',
    /\b(description|desc|details?|narration|particulars|remarks|memo|payee|transaction|verwendungszweck|buchungstext|beschreibung|vorgang|concepto|descripcion|libelle|operations?|omschrijving|descrizione|causale|descricao|historico|text)\b/,
  ],
];

/** Map a header label like "Withdrawal Amt (INR)" to a column role. */
export function roleForHeader(label: string, extra?: Partial<Record<ColumnRole, string[]>>): ColumnRole | undefined {
  const text = normalize(label).replace(/[()[\]:]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!text || text.length > 40) return undefined;

  if (extra) {
    for (const [role, labels] of Object.entries(extra) as [ColumnRole, string[]][]) {
      if (labels?.some((l) => normalize(l) === text)) return role;
    }
  }
  for (const [role, re] of RULES) {
    if (re.test(text)) return role;
  }
  return undefined;
}

export const NUMERIC_ROLES: ReadonlySet<ColumnRole> = new Set(['debit', 'credit', 'amount', 'balance']);
