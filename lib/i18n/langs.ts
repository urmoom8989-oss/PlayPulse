// Language and Location (032): what can be picked, and how a choice is read.
// No imports, so Node can load this file directly.

export const LANGS = [
  { code: "en", name: "English" },
  { code: "es", name: "Español" },
  { code: "fr", name: "Français" },
  { code: "de", name: "Deutsch" },
  { code: "pt", name: "Português" },
  { code: "ja", name: "日本語" },
] as const;

export type Lang = (typeof LANGS)[number]["code"];

export const LANG_COOKIE = "pp_lang";
export const LOCATION_COOKIE = "pp_loc";
/** A year, like the other remembered choices. */
export const PREF_MAX_AGE = 365 * 24 * 3600;

export function isLang(v: unknown): v is Lang {
  return typeof v === "string" && LANGS.some((l) => l.code === v);
}

/** The places Location offers (ISO 3166 codes), like 2020's list of the biggest. */
export const LOCATIONS = [
  "AR", "AU", "AT", "BE", "BR", "CA", "CL", "CO", "CZ", "DK", "EG", "FI", "FR", "DE", "GR", "HK", "HU", "IN", "ID", "IE",
  "IL", "IT", "JP", "KE", "MY", "MX", "NL", "NZ", "NG", "NO", "PE", "PH", "PL", "PT", "RO", "RU", "SA", "SG", "ZA", "KR",
  "ES", "SE", "CH", "TW", "TH", "TR", "UA", "AE", "GB", "US", "VN",
] as const;

export function isLocation(v: unknown): v is string {
  return typeof v === "string" && (LOCATIONS as readonly string[]).includes(v);
}

/** The languages an Accept-Language header asks for, best first ("es-MX,es;q=0.9,en;q=0.5"). */
function accepted(header: string | null | undefined): { tag: string; q: number }[] {
  return String(header ?? "")
    .split(",")
    .map((part) => {
      const [tag, ...params] = part.trim().split(";");
      const q = Number(params.find((p) => p.trim().startsWith("q="))?.trim().slice(2) ?? 1);
      return { tag: tag.trim(), q: Number.isFinite(q) ? q : 0 };
    })
    .filter((x) => x.tag && x.tag !== "*")
    .sort((a, b) => b.q - a.q);
}

/** The language to use: the cookie, else the browser's first supported one, else English. */
export function pickLang(cookie: string | null | undefined, acceptLanguage: string | null | undefined): Lang {
  if (isLang(cookie)) return cookie;
  for (const { tag } of accepted(acceptLanguage)) {
    const primary = tag.toLowerCase().split("-")[0];
    if (isLang(primary)) return primary;
  }
  return "en";
}

/** The location to use: the cookie, else the region of the browser's languages, else the United States. */
export function pickLocation(cookie: string | null | undefined, acceptLanguage: string | null | undefined): string {
  if (isLocation(cookie)) return cookie;
  for (const { tag } of accepted(acceptLanguage)) {
    const region = tag.split("-")[1]?.toUpperCase();
    if (isLocation(region)) return region;
  }
  return "US";
}

/** A place's name in a language ("Canada", "Canadá"), from the browser's or Node's own list. */
export function locationName(code: string, lang: Lang): string {
  try {
    return new Intl.DisplayNames([lang], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** The language's own name, for the menu ("Language: Español"). */
export function langName(code: Lang): string {
  return LANGS.find((l) => l.code === code)?.name ?? "English";
}
