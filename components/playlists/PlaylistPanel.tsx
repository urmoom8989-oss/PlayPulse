"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Thumb } from "@/components/Thumb";
import { ExpandLessIcon, ExpandMoreIcon, PlayIcon } from "@/components/icons";
import { hiddenText, playlistHref, positionOf, watchInList, type PlaylistHeader, type PlaylistItem } from "@/lib/playlists/rules";
import { formatTime } from "@/lib/watch/format";

/**
 * The 2020 playlist box above Up next on /watch?v=...&list=...: the title
 * (to the playlist page), "owner - 3 / 12", and the videos with the one
 * playing marked, scrolled into view. The arrow folds it to the header.
 */
export function PlaylistPanel({ header, items, videoId }: { header: PlaylistHeader; items: PlaylistItem[]; videoId: string }) {
  const [open, setOpen] = useState(true);
  const listRef = useRef<HTMLOListElement>(null);
  const at = positionOf(items, videoId);
  const hidden = hiddenText(header.hidden);

  useEffect(() => {
    const list = listRef.current;
    const current = list?.querySelector<HTMLElement>("[data-current]");
    if (list && current) list.scrollTop = current.offsetTop - list.offsetTop - 8;
  }, [videoId, open]);

  return (
    <section className="mx-3 mb-4 overflow-hidden border border-divider tab:mx-0" data-playlist-panel={header.id} aria-label={`Playlist: ${header.title}`}>
      <div className="flex items-start gap-2 bg-hover py-3 pl-4 pr-1">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[18px] leading-6 text-text">
            <Link href={playlistHref(header.id)} className="hover:underline" data-playlist-panel-title>
              {header.title}
            </Link>
          </h2>
          <p className="mt-0.5 truncate text-[13px] leading-[18px] text-text-2">
            {header.owner.handle ? (
              <Link href={`/@${header.owner.handle}`} className="hover:text-text">
                {header.owner.name}
              </Link>
            ) : (
              header.owner.name
            )}{" "}
            - <span data-playlist-panel-index>{at > 0 ? `${at} / ${items.length}` : items.length}</span>
          </p>
        </div>
        <button
          type="button"
          aria-label={open ? "Hide the playlist" : "Show the playlist"}
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-icon hover:bg-hover"
        >
          {open ? <ExpandLessIcon className="h-6 w-6" /> : <ExpandMoreIcon className="h-6 w-6" />}
        </button>
      </div>
      {open && (
        <ol ref={listRef} className="relative max-h-[400px] overflow-y-auto border-t border-divider py-2" data-playlist-panel-list>
          {items.map((v, i) => {
            const current = v.id === videoId;
            return (
              <li key={v.id} data-current={current ? "" : undefined}>
                <Link
                  href={watchInList(v.id, header.id)}
                  className={`flex items-center gap-2 py-1 pr-2 ${current ? "bg-[var(--active)]" : "hover:bg-hover"}`}
                  aria-current={current ? "true" : undefined}
                >
                  <span className="grid w-6 shrink-0 place-items-center text-[12px] text-text-2">
                    {current ? <PlayIcon className="h-3 w-3 text-text-2" /> : i + 1}
                  </span>
                  <span className="relative block aspect-video w-[100px] shrink-0 overflow-hidden bg-skeleton">
                    <Thumb src={v.thumbnail} alt="" sizes="100px" />
                    {v.durationS !== null && (
                      <span className="absolute bottom-1 right-1 bg-black/80 px-1 py-[2px] text-[11px] font-medium leading-3 text-white">
                        {formatTime(v.durationS)}
                      </span>
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="line-clamp-2 text-[14px] font-medium leading-5 text-text">{v.title}</span>
                    <span className="block truncate text-[13px] leading-[18px] text-text-2">{v.channel.name}</span>
                  </span>
                </Link>
              </li>
            );
          })}
          {items.length === 0 && <li className="px-4 py-2 text-[13px] text-text-2">This playlist has no videos you can watch.</li>}
          {hidden && <li className="px-4 py-2 text-[12px] text-text-2">{hidden}</li>}
        </ol>
      )}
    </section>
  );
}
