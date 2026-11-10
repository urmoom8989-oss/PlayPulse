"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { Thumb } from "@/components/Thumb";
import { CARD_TEASER_MS, cardTeaser, type WatchCard } from "@/lib/cards/rules";
import { formatTime, shortCount } from "@/lib/watch/format";

/** The round "i" of 2020 cards. */
function InfoIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M11 10.5h2V17h-2zM11 7h2v2h-2z" fill="currentColor" />
    </svg>
  );
}

const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();

/**
 * Cards on the player (041), like 2020: when a card's time comes, its message
 * slides in at the top right for a few seconds; the "i" there (shown with the
 * controls) opens the list of the video's cards on the right of the player.
 * A video or channel card opens on this site, a link in a new tab.
 */
export function VideoCards({ cards, time, chrome, hidden }: { cards: WatchCard[]; time: number; chrome: boolean; hidden: boolean }) {
  const [teaser, setTeaser] = useState<WatchCard | null>(null);
  const [open, setOpen] = useState(false);
  const seen = useRef(new Set<string>());
  const last = useRef(time);

  // A card whose time was just passed while playing (not jumped over by a seek far ahead) shows its message.
  useEffect(() => {
    const from = last.current;
    last.current = time;
    if (time < from || time - from > 2) return;
    const due = cards.filter((c) => c.startS > from - 0.001 && c.startS <= time && !seen.current.has(c.id)).at(-1);
    if (!due) return;
    seen.current.add(due.id);
    setTeaser(due);
  }, [cards, time]);
  useEffect(() => {
    if (!teaser) return;
    const done = setTimeout(() => setTeaser(null), CARD_TEASER_MS);
    return () => clearTimeout(done);
  }, [teaser]);

  if (cards.length === 0 || hidden) return null;
  const showIcon = chrome || teaser !== null;

  return (
    <div
      data-cards={cards.length}
      className="pointer-events-none absolute inset-x-0 top-0 bottom-[49px] z-20 overflow-hidden"
      onPointerUp={stop as (e: PointerEvent) => void}
    >
      {!open && (
        <button
          type="button"
          aria-label={teaser ? `Card: ${cardTeaser(teaser)}` : "Show cards"}
          data-cards-button={teaser ? "teaser" : "icon"}
          onClick={(e) => {
            stop(e);
            setTeaser(null);
            setOpen(true);
          }}
          className={`pointer-events-auto absolute right-3 top-3 flex h-8 max-w-[70%] items-center gap-2 rounded-[2px] text-white transition-opacity duration-200 ${
            showIcon ? "opacity-100" : "pointer-events-none opacity-0"
          } ${teaser ? "pp-card-teaser bg-black/70 pl-3 pr-1.5" : "px-1"}`}
        >
          {teaser && <span className="truncate text-[13px] font-medium leading-4">{cardTeaser(teaser)}</span>}
          <InfoIcon className="h-6 w-6 shrink-0 drop-shadow-[0_0_2px_rgba(0,0,0,.6)]" />
        </button>
      )}

      {open && (
        <aside
          aria-label="Cards"
          data-cards-panel
          onClick={stop}
          className="pp-card-panel pointer-events-auto absolute inset-y-0 right-0 flex w-[min(340px,70%)] flex-col bg-black/85 text-white"
        >
          <div className="flex h-12 shrink-0 items-center justify-between pl-4 pr-1">
            <span className="text-[15px] font-medium">Cards</span>
            <button type="button" aria-label="Close cards" onClick={() => setOpen(false)} className="grid h-10 w-10 place-items-center rounded-full hover:bg-white/10">
              <svg viewBox="0 0 24 24" className="h-6 w-6" aria-hidden>
                <path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" fill="currentColor" />
              </svg>
            </button>
          </div>
          <ol className="flex-1 space-y-4 overflow-y-auto px-4 pb-4">
            {cards.map((c) => (
              <li key={c.id} data-card={c.kind}>
                {c.message && <p className="mb-1.5 truncate text-[12px] uppercase tracking-[0.3px] text-[#aaaaaa]">{c.message}</p>}
                <CardBody card={c} />
              </li>
            ))}
          </ol>
        </aside>
      )}
    </div>
  );
}

function CardLink({ card, children }: { card: WatchCard; children: ReactNode }) {
  const cls = "flex gap-3 rounded-[2px] bg-white/5 p-2 hover:bg-white/15";
  if (card.kind === "video" && card.video) return <Link href={`/watch?v=${card.video.id}`} className={cls}>{children}</Link>;
  if (card.kind === "channel" && card.channel) return <Link href={`/@${card.channel.handle}`} className={cls}>{children}</Link>;
  return (
    <a href={card.url ?? "#"} target="_blank" rel="nofollow noopener noreferrer ugc" className={cls}>
      {children}
    </a>
  );
}

function CardBody({ card }: { card: WatchCard }) {
  if (card.kind === "video" && card.video) {
    const v = card.video;
    return (
      <CardLink card={card}>
        <span className="relative block aspect-video w-[120px] shrink-0 overflow-hidden bg-[#222]">
          <Thumb src={v.thumbnail ?? `/api/media/${v.id}/thumb-1.webp`} alt="" sizes="120px" />
          {v.durationS !== null && (
            <span className="absolute bottom-1 right-1 bg-black/80 px-1 text-[11px] font-medium leading-4">{formatTime(v.durationS)}</span>
          )}
        </span>
        <span className="min-w-0">
          <span className="line-clamp-2 text-[13px] font-medium leading-[18px]">{v.title}</span>
          <span className="mt-1 block truncate text-[12px] text-[#aaaaaa]">
            {v.channelName ? `${v.channelName} · ` : ""}
            {shortCount(v.views)} views
          </span>
        </span>
      </CardLink>
    );
  }
  if (card.kind === "channel" && card.channel) {
    const ch = card.channel;
    return (
      <CardLink card={card}>
        <span className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-full bg-[#444] text-[18px] font-medium">
          {ch.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={ch.avatarUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            ch.name.slice(0, 1).toUpperCase()
          )}
        </span>
        <span className="min-w-0 self-center">
          <span className="block truncate text-[14px] font-medium">{ch.name}</span>
          <span className="block truncate text-[12px] text-[#aaaaaa]">{shortCount(ch.subscribers)} subscribers</span>
        </span>
      </CardLink>
    );
  }
  let host = card.url ?? "";
  try {
    host = new URL(host).hostname.replace(/^www\./, "");
  } catch {
    // Shown as it is.
  }
  return (
    <CardLink card={card}>
      <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-[#444]">
        <svg viewBox="0 0 24 24" className="h-6 w-6" aria-hidden>
          <path
            d="M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z"
            fill="currentColor"
          />
        </svg>
      </span>
      <span className="min-w-0 self-center">
        <span className="block truncate text-[14px] font-medium">{host}</span>
        <span className="block truncate text-[12px] text-[#aaaaaa]">{card.url}</span>
      </span>
    </CardLink>
  );
}
