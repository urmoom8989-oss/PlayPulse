// Numbers and dates in the viewer's language (032). English keeps the site's
// own 2019 wording; the others use the browser's (or Node's) Intl.
// Only relative imports.

import type { Lang } from "./langs.ts";
import { translate } from "./t.ts";

const LOCALE: Record<Lang, string> = { en: "en-US", es: "es", fr: "fr", de: "de", pt: "pt-BR", ja: "ja" };

export function localeOf(lang: Lang): string {
  return LOCALE[lang];
}

/** "1.2K" style counts. */
export function compact(lang: Lang, n: number): string {
  return new Intl.NumberFormat(LOCALE[lang], { notation: "compact", maximumFractionDigits: 1 }).format(Math.max(0, n || 0));
}

/** "1.2K views" (English stays as the site always said it: pass the English text). */
export function viewsIn(lang: Lang, n: number, english: string): string {
  if (lang === "en") return english;
  return translate(lang, n === 1 ? "{n} view" : "{n} views", { n: compact(lang, n) });
}

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 86400],
  ["month", 30 * 86400],
  ["week", 7 * 86400],
  ["day", 86400],
  ["hour", 3600],
  ["minute", 60],
  ["second", 1],
];

/** "3 days ago", "hace 3 días", "il y a 3 jours". */
export function agoIn(lang: Lang, iso: string | null, now: number | undefined, english: string): string {
  if (lang === "en" || !iso) return english;
  now ??= Date.now();
  const s = Math.max(0, (now - Date.parse(iso)) / 1000);
  const [unit, size] = UNITS.find(([, size]) => s >= size) ?? ["second", 1];
  return new Intl.RelativeTimeFormat(LOCALE[lang], { numeric: "always" }).format(-Math.floor(s / size), unit);
}

/** "Nov 8, 2026" in the language. */
export function dateIn(lang: Lang, iso: string, english: string): string {
  if (lang === "en") return english;
  return new Date(iso).toLocaleDateString(LOCALE[lang], { year: "numeric", month: "short", day: "numeric" });
}

/** "1.2K subscribers" / "No subscribers". */
export function subscribersIn(lang: Lang, n: number, english: string): string {
  if (lang === "en") return english;
  if (!(n > 0)) return translate(lang, "No subscribers");
  return translate(lang, n === 1 ? "{n} subscriber" : "{n} subscribers", { n: compact(lang, n) });
}
