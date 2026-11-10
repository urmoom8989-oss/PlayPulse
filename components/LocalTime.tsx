"use client";

import { useHydrated } from "@/lib/hydrated";
import { scheduleLabel } from "@/lib/upload/options-rules";

/**
 * A time in the viewer's own time zone ("Tue, Nov 10, 2026, 6:00 PM"). The
 * server does not know that zone, so the words appear once the page is in
 * the browser.
 */
export function LocalTime({ at }: { at: string }) {
  const hydrated = useHydrated();
  return <time dateTime={at}>{hydrated ? scheduleLabel(at) : ""}</time>;
}
