"use client";

import { useEffect, useState } from "react";
import { useLive } from "@/lib/store/live";
import { broadcastMeta, type Broadcast } from "@/lib/live/state";

/**
 * The line under the title for a Premiere or live broadcast: "12 waiting ·
 * Premieres Nov 9, 2026, 7:00 PM", "40 watching now · Started streaming 5
 * minutes ago", or "Streamed live on Nov 8, 2026" afterwards. The count comes
 * from the chat's presence pings.
 */
export function BroadcastMeta({ videoId, broadcast }: { videoId: string; broadcast: Broadcast }) {
  const viewers = useLive((s) => s.viewers[videoId]) ?? broadcast.viewers;
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
  return <span data-broadcast-meta={broadcast.state}>{broadcastMeta({ ...broadcast, viewers }, now ?? Date.parse(broadcast.at))}</span>;
}
