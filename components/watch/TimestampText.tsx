"use client";

import type { MouseEvent } from "react";
import { useWatch } from "@/lib/store/watch";
import { splitTimestamps } from "@/lib/watch/chapters";

/**
 * Text with its timestamps (1:05, 1:02:05) as links, like the 2020 watch page
 * (player extras). A click jumps the player on this page and scrolls up to
 * it; without a player for this video, or with a modifier key or the middle
 * button, the link just opens /watch?v=...&t=... .
 */
export function TimestampText({ text, videoId }: { text: string; videoId: string }) {
  const parts = splitTimestamps(text);
  return (
    <>
      {parts.map((p, i) =>
        p.seconds === undefined ? (
          p.text
        ) : (
          <a
            key={i}
            href={`/watch?v=${encodeURIComponent(videoId)}&t=${p.seconds}s`}
            data-timestamp={p.seconds}
            className="text-link"
            onClick={(e) => jump(e, videoId, p.seconds ?? 0)}
          >
            {p.text}
          </a>
        ),
      )}
    </>
  );
}

function jump(e: MouseEvent<HTMLAnchorElement>, videoId: string, seconds: number) {
  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const watch = useWatch.getState();
  if (watch.playerVideoId !== videoId) return;
  e.preventDefault();
  watch.requestSeek(videoId, seconds);
}
