// Spelling correction on /results (the search_spelling flag), the parts that
// need no database. Only relative imports, so Node can load this file directly.

import { resultsHref, type SearchFilters } from "./query.ts";

/**
 * What the results page does with a correction:
 * - "showing": what was typed found nothing, so the corrected query's results
 *   show, under "Showing results for ... / Search instead for ...".
 * - "did-you-mean": what was typed found something; a link offers the fix.
 * - "none": no correction, or the person asked for exactly what they typed.
 */
export type SpellingMode = "showing" | "did-you-mean" | "none";

export function spellingMode(typed: string, corrected: string | null, typedFoundSomething: boolean, exact: boolean): SpellingMode {
  if (exact || !corrected || corrected === typed) return "none";
  return typedFoundSomething ? "did-you-mean" : "showing";
}

/** The corrected query's words, each marked when it differs from what was typed (shown bold and italic). */
export function markCorrection(typed: string, corrected: string): { text: string; changed: boolean }[] {
  const before = typed.toLowerCase().split(/\s+/).filter(Boolean);
  return corrected
    .split(/\s+/)
    .filter(Boolean)
    .map((w, i) => ({ text: w, changed: before[i] !== w.toLowerCase() }));
}

/** "Search instead for": the typed query with exact=1, so it is not corrected again. */
export function exactHref(q: string, f: SearchFilters = {}): string {
  return `${resultsHref(q, f)}&exact=1`;
}
