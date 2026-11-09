import { cardBadge } from "@/lib/live/state";
import type { CardBroadcast } from "@/lib/live/types";

// No "use client": server pages and client lists both render cards.

/** PREMIERE / UPCOMING on a thumbnail, or the red LIVE NOW, in the duration's corner. */
export function CardBadge({ broadcast }: { broadcast: CardBroadcast }) {
  const badge = cardBadge(broadcast);
  if (!badge) return null;
  return (
    <span
      data-card-badge={broadcast.state}
      className={`absolute bottom-1 right-1 flex items-center gap-1 px-1 py-[3px] text-[12px] font-medium leading-3 tracking-[0.5px] text-white ${
        badge.live ? "bg-[#cc0000]" : "bg-black/80"
      }`}
    >
      {badge.live && <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-white" />}
      {badge.text}
    </span>
  );
}

/** Is this card a broadcast that is coming or on (so the badge replaces the duration)? */
export function onAirOrSoon(b: CardBroadcast | null | undefined): b is CardBroadcast {
  return !!b && (b.state === "upcoming" || b.state === "live");
}
