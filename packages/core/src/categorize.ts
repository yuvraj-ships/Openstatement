/**
 * Simple keyword categories. Deliberately small and transparent: every rule is a readable regex,
 * so anyone can add their country's shops and services in a pull request.
 */
export const CATEGORY_RULES: [string, RegExp][] = [
  ['Income', /\b(salary|payroll|wages?|gehalt|lohn|salaire|sueldo|nomina|stipendio|salario|direct\s*dep|dividend|interest\s*(credit|paid|earned)|refund|cashback)\b/i],
  ['Groceries', /\b(grocery|groceries|supermarket|walmart|costco|tesco|sainsbury|asda|aldi|lidl|carrefour|rewe|edeka|kroger|whole\s*foods|trader\s*joe|safeway|woolworths|coles|big\s*bazaar|dmart|reliance\s*fresh|blinkit|zepto|instacart|mercadona|albert\s*heijn|migros|coop)\b/i],
  ['Dining', /\b(restaurant|cafe|café|coffee|starbucks|mcdonald|burger|kfc|pizza|domino|subway|swiggy|zomato|ubereats|uber\s*eats|deliveroo|doordash|grubhub|just\s*eat|foodpanda|talabat|bar|pub|bistro)\b/i],
  ['Transport', /\b(uber|lyft|ola|bolt|grab|didi|taxi|cab|metro|subway\s*fare|transit|train|rail|bus|fuel|petrol|gas\s*station|shell|bp|esso|chevron|exxon|indian\s*oil|hpcl|bpcl|parking|toll|fastag)\b/i],
  ['Travel', /\b(airline|airways|air\s*lines|flight|airbnb|booking\.com|expedia|hotel|marriott|hilton|ryanair|easyjet|lufthansa|emirates|indigo|makemytrip|irctc|agoda)\b/i],
  ['Shopping', /\b(amazon|amzn|flipkart|myntra|ebay|etsy|aliexpress|temu|shein|target|ikea|zara|h&m|best\s*buy|apple\s*store|mercado\s*libre|zalando|otto)\b/i],
  ['Subscriptions', /\b(netflix|spotify|youtube|prime\s*video|disney|hulu|hbo|apple\.com|icloud|google\s*(one|storage)|microsoft|office\s*365|adobe|dropbox|chatgpt|openai|anthropic|claude|github|patreon|hotstar|jiocinema)\b/i],
  ['Bills & Utilities', /\b(electric|electricity|power|water|gas\s*bill|utility|utilities|internet|broadband|wifi|mobile|phone|telecom|vodafone|verizon|at&t|t-mobile|airtel|jio|bsnl|comcast|xfinity|bt\s*group|telekom|orange|movistar)\b/i],
  ['Rent & Housing', /\b(rent|miete|loyer|alquiler|affitto|mortgage|hypothek|landlord|housing|hoa|maintenance\s*charges?)\b/i],
  ['Health', /\b(pharmacy|chemist|apotheke|pharmacie|farmacia|hospital|clinic|doctor|dental|dentist|medical|cvs|walgreens|boots|apollo|practo|1mg|pharmeasy)\b/i],
  ['Insurance', /\b(insurance|versicherung|assurance|seguro|assicurazione|lic\b|premium)\b/i],
  ['Education', /\b(school|college|university|tuition|course|udemy|coursera|byju|unacademy|edx|duolingo)\b/i],
  ['Cash', /\b(atm|cash\s*(withdrawal|wdl)|nwd|geldautomat|retrait|cajero|prelievo)\b/i],
  ['Fees & Charges', /\b(fee|fees|charge|charges|commission|gebühr|gebuhr|frais|comision|commissione|penalty|overdraft|gst\s*on|service\s*tax)\b/i],
  ['Taxes', /\b(tax|irs|hmrc|finanzamt|income\s*tax|tds|vat|impots|hacienda)\b/i],
  ['Investments', /\b(zerodha|groww|upstox|robinhood|vanguard|fidelity|schwab|etoro|trading\s*212|mutual\s*fund|sip|brokerage|crypto|coinbase|binance)\b/i],
  ['Entertainment', /\b(cinema|movie|theatre|theater|bookmyshow|ticketmaster|steam|playstation|xbox|nintendo|concert)\b/i],
  // Last, so "UPI/DMART" is Groceries rather than a generic transfer.
  ['Transfers', /\b(transfer|trf|neft|imps|rtgs|upi|sepa|ueberweisung|überweisung|virement|transferencia|bonifico|zelle|venmo|paypal|wise|revolut|interac|e-?transfer|faster\s*payment|fps|ach|giro|pix|m-?pesa)\b/i],
];

export function categorize(description: string, amount: number): string {
  for (const [category, re] of CATEGORY_RULES) {
    if (category === 'Income' && amount < 0) continue;
    if (re.test(description)) return category;
  }
  return amount > 0 ? 'Other income' : 'Other';
}
