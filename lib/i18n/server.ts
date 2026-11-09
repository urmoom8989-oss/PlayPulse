import "server-only";
import { cookies, headers } from "next/headers";
import { flagOn } from "@/lib/flags";
import { LANG_COOKIE, LOCATION_COOKIE, pickLang, pickLocation, type Lang } from "./langs";
import { tFor, type T } from "./t";

/**
 * The language and location for this request (the language_location flag):
 * the cookies the menus set, else the browser's languages. English and the
 * United States while the flag is off. Reads the request: inside <Suspense>.
 */
export async function getPrefs(): Promise<{ lang: Lang; location: string }> {
  const [jar, h] = await Promise.all([cookies(), headers()]);
  const accept = h.get("accept-language");
  if (!(await flagOn("language_location"))) return { lang: "en", location: pickLocation(jar.get(LOCATION_COOKIE)?.value, accept) };
  return { lang: pickLang(jar.get(LANG_COOKIE)?.value, accept), location: pickLocation(jar.get(LOCATION_COOKIE)?.value, accept) };
}

/** The translate function for this request. */
export async function getT(): Promise<{ t: T; lang: Lang }> {
  const { lang } = await getPrefs();
  return { t: tFor(lang), lang };
}
