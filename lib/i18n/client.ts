"use client";

import { useMemo } from "react";
import { useSession } from "@/lib/store/session";
import { LANG_COOKIE, LOCATION_COOKIE, PREF_MAX_AGE, type Lang } from "./langs";
import { tFor, type T } from "./t";

/** The translate function for the language in the session store (English until the server says). */
export function useT(): T {
  const lang = useSession((s) => s.lang);
  return useMemo(() => tFor(lang), [lang]);
}

export function useLang(): Lang {
  return useSession((s) => s.lang);
}

/** Remembers a choice from the menu in a cookie (a year) and shows it at once. */
export function savePref(name: "lang" | "location", value: string) {
  const cookie = name === "lang" ? LANG_COOKIE : LOCATION_COOKIE;
  document.cookie = `${cookie}=${encodeURIComponent(value)}; path=/; max-age=${PREF_MAX_AGE}; samesite=lax`;
}
