"use client";

import { useEffect, useState } from "react";
import { useLive } from "@/lib/store/live";
import { broadcastMeta, formatWhen, roughDuration, elapsedSeconds, type Broadcast } from "@/lib/live/state";
import { useLang, useT } from "@/lib/i18n/client";
import { localeOf } from "@/lib/i18n/format";

/**
 * The line under the title for a Premiere or live broadcast: "12 waiting ·
 * Premieres Nov 9, 2026, 7:00 PM", "40 watching now · Started streaming 5
 * minutes ago", or "Streamed live on Nov 8, 2026" afterwards. The count comes
 * from the chat's presence pings.
 */
export function BroadcastMeta({ videoId, broadcast }: { videoId: string; broadcast: Broadcast }) {
  const viewers = useLive((s) => s.viewers[videoId]) ?? broadcast.viewers;
  const t = useT();
  const lang = useLang();
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const t = setInterval(tick, 30000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, []);
  const at = now ?? Date.parse(broadcast.at);
  if (lang === "en") return <span data-broadcast-meta={broadcast.state}>{broadcastMeta({ ...broadcast, viewers }, at)}</span>;
  const premiere = broadcast.kind === "premiere";
  const n = viewers.toLocaleString(localeOf(lang));
  const when = (withTime: boolean) => formatWhen(broadcast.at, withTime, localeOf(lang));
  const text =
    broadcast.state === "upcoming"
      ? `${t("{n} waiting", { n })} · ${t(premiere ? "Premieres {date}" : "Scheduled for {date}", { date: when(true) })}`
      : broadcast.state === "live"
        ? `${t("{n} watching now", { n })} · ${t(premiere ? "Premiere in progress. Started {ago} ago" : "Started streaming {ago} ago", { ago: roughDuration(elapsedSeconds(broadcast.at, at)) })}`
        : t(premiere ? "Premiered {date}" : "Streamed live on {date}", { date: when(false) });
  return <span data-broadcast-meta={broadcast.state}>{text}</span>;
}
