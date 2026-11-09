// Translating the site's own words (032). Keys are the English text itself, so
// English needs no dictionary and a missing key shows English, never a code.
// {name} in a key is filled from vars. Only relative imports.

import de from "./dict/de.ts";
import es from "./dict/es.ts";
import fr from "./dict/fr.ts";
import ja from "./dict/ja.ts";
import pt from "./dict/pt.ts";
import type { Lang } from "./langs.ts";

const DICTS: Record<Exclude<Lang, "en">, Record<string, string>> = { es, fr, de, pt, ja };

export type Vars = Record<string, string | number>;

export function fill(text: string, vars?: Vars): string {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

export function translate(lang: Lang, key: string, vars?: Vars): string {
  const dict = lang === "en" ? null : DICTS[lang];
  return fill(dict?.[key] ?? key, vars);
}

export type T = (key: string, vars?: Vars) => string;

export function tFor(lang: Lang): T {
  return (key, vars) => translate(lang, key, vars);
}

/** Every key a dictionary has: the tests check they all match the English keys used. */
export function dictionaryKeys(lang: Exclude<Lang, "en">): string[] {
  return Object.keys(DICTS[lang]);
}
