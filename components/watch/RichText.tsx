"use client";

import Link from "next/link";
import type { MouseEvent } from "react";
import { useWatch } from "@/lib/store/watch";
import { hashtagHref, splitRich } from "@/lib/watch/richtext";

/**
 * A description with working links, like the 2020 watch page: web addresses
 * open in a new tab, #hashtags open their page, and with player extras
 * timestamps jump the player (a click with a modifier key opens the link).
 */
export function RichText({ text, videoId, times }: { text: string; videoId: string; times: boolean }) {
  return (
    <>
      {splitRich(text, { times }).map((p, i) => {
        switch (p.kind) {
          case "text":
            return p.text;
          case "link":
            return (
              <a key={i} href={p.href} target="_blank" rel="nofollow noopener noreferrer ugc" className="text-link" data-description-link>
                {p.text}
              </a>
            );
          case "tag":
            return (
              <Link key={i} href={hashtagHref(p.tag)} className="text-link" data-hashtag={p.tag.toLowerCase()}>
                {p.text}
              </Link>
            );
          case "time":
            return (
              <a
                key={i}
                href={`/watch?v=${encodeURIComponent(videoId)}&t=${p.seconds}s`}
                data-timestamp={p.seconds}
                className="text-link"
                onClick={(e) => jump(e, videoId, p.seconds)}
              >
                {p.text}
              </a>
            );
        }
      })}
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
