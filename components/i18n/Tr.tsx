"use client";

import { useLang, useT } from "@/lib/i18n/client";
import { agoIn, viewsIn } from "@/lib/i18n/format";
import type { Vars } from "@/lib/i18n/t";

/**
 * The site's own words in the viewer's language (032), for components that
 * the server and the browser both render. English is the key itself.
 */
export function Tr({ children, vars }: { children: string; vars?: Vars }) {
  const t = useT();
  return <>{t(children, vars)}</>;
}

/** "1.2K views · 3 days ago" in the viewer's language; English keeps the text it is given. */
export function ViewsAgo({
  views,
  iso,
  now,
  english,
  sep = " · ",
}: {
  views: number;
  iso: string | null;
  /** The server's clock, so the text matches after hydration; the browser's when left out. */
  now?: number;
  english: [string, string];
  sep?: string;
}) {
  const lang = useLang();
  return (
    <>
      {viewsIn(lang, views, english[0])}
      {iso ? `${sep}${agoIn(lang, iso, now, english[1])}` : ""}
    </>
  );
}
