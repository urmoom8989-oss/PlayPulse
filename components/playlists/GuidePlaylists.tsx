"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ExpandLessIcon, ExpandMoreIcon, PlaylistPlayIcon, WatchLaterIcon } from "@/components/icons";
import { PLAYLISTS_CHANGED, playlistCall } from "@/lib/playlists/client";
import { playlistHref, type PlaylistSummary } from "@/lib/playlists/rules";
import { useSession } from "@/lib/store/session";

/** The guide shows this many playlists before "Show more". */
const SHOWN = 4;

/**
 * The guide's playlists under Library and History, 2020 style: Watch later,
 * then your playlists, newest change first. Reloads when a playlist changes
 * anywhere on the page. Only rendered for signed in people with the flag on.
 */
export function GuidePlaylists({ onNavigate, active }: { onNavigate?: () => void; active?: string | null }) {
  const userId = useSession((s) => s.user?.id ?? null);
  const [lists, setLists] = useState<PlaylistSummary[]>([]);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!userId) return;
    let live = true;
    const load = () =>
      playlistCall<{ playlists: PlaylistSummary[] }>("/api/playlists")
        .then((r) => live && setLists(r.playlists))
        .catch(() => {});
    void load();
    window.addEventListener(PLAYLISTS_CHANGED, load);
    return () => {
      live = false;
      window.removeEventListener(PLAYLISTS_CHANGED, load);
    };
  }, [userId]);

  const shown = expanded ? lists : lists.slice(0, SHOWN);
  const more = lists.length - SHOWN;

  return (
    <div data-guide-playlists={lists.length}>
      {shown.map((l) => {
        const Icon = l.kind === "watch_later" ? WatchLaterIcon : PlaylistPlayIcon;
        const href = playlistHref(l.id);
        return (
          <Link
            key={l.id}
            href={href}
            onClick={onNavigate}
            className={`flex h-10 items-center px-6 text-[14px] hover:bg-hover ${active === l.id ? "bg-[var(--active)] font-medium" : ""}`}
            data-guide-playlist={l.kind}
          >
            <Icon className="mr-6 h-6 w-6 shrink-0 text-icon" />
            <span className="min-w-0 flex-1 truncate">{l.title}</span>
          </Link>
        );
      })}
      {more > 0 && (
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="flex h-10 w-full items-center px-6 text-left text-[14px] text-text hover:bg-hover"
          data-guide-playlists-more
        >
          {expanded ? <ExpandLessIcon className="mr-6 h-6 w-6 shrink-0 text-icon" /> : <ExpandMoreIcon className="mr-6 h-6 w-6 shrink-0 text-icon" />}
          {expanded ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}
