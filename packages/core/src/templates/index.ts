import type { Template } from '../types.js';
import { normalize } from '../tokens.js';

import regionUs from './presets/region-us.json';
import regionDmyDot from './presets/region-dmy-dot.json';
import regionDmyComma from './presets/region-dmy-comma.json';
import regionYmd from './presets/region-ymd.json';

/**
 * Built-in templates.
 *
 * - `presets/` are region formats you can pick manually when auto-detection guesses wrong.
 * - `banks/<country>/<bank>.json` are bank-specific templates contributed by the community.
 *   They are applied automatically when `detect.contains` matches the statement text.
 *
 * To add a bank: export a template from the web app (or write one by hand), save it under
 * `banks/<country-code>/`, import it below and add it to the list. See CONTRIBUTING.md.
 */
export const templates: Template[] = [regionUs, regionDmyDot, regionDmyComma, regionYmd] as Template[];

export function findTemplate(id: string): Template | undefined {
  return templates.find((t) => t.id === id);
}

/** The first bank template whose `detect.contains` strings all appear in the statement. */
export function matchTemplate(text: string): Template | undefined {
  const haystack = normalize(text);
  return templates.find((t) => {
    const needles = t.detect?.contains;
    return needles && needles.length > 0 && needles.every((n) => haystack.includes(normalize(n)));
  });
}

/** Check a template (e.g. one loaded from a user's file) before using it. */
export function validateTemplate(value: unknown): { ok: true; template: Template } | { ok: false; error: string } {
  const t = value as Partial<Template>;
  if (!t || typeof t !== 'object') return { ok: false, error: 'Template must be a JSON object.' };
  if (typeof t.id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(t.id)) {
    return { ok: false, error: '"id" must be lower-case letters, digits and dashes, e.g. "gb-monzo".' };
  }
  if (typeof t.name !== 'string' || !t.name.trim()) return { ok: false, error: '"name" is required.' };
  if (typeof t.country !== 'string' || !/^[A-Z]{2}$/.test(t.country)) {
    return { ok: false, error: '"country" must be a 2-letter code like "GB" (or "XX").' };
  }
  if (t.dateOrder && !['DMY', 'MDY', 'YMD'].includes(t.dateOrder)) return { ok: false, error: '"dateOrder" must be DMY, MDY or YMD.' };
  if (t.numberFormat && !['.', ','].includes(t.numberFormat.decimal)) {
    return { ok: false, error: '"numberFormat.decimal" must be "." or ",".' };
  }
  for (const s of t.skip ?? []) {
    try {
      new RegExp(s, 'i');
    } catch {
      return { ok: false, error: `Invalid regular expression in "skip": ${s}` };
    }
  }
  return { ok: true, template: t as Template };
}
