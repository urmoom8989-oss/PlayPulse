"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Thumb } from "@/components/Thumb";
import { AUTOPLAY_COUNTDOWN_S, secondsLeft } from "@/lib/watch/endscreen";
import { formatTime, shortCount } from "@/lib/watch/format";
import type { UpNextVideo } from "@/lib/watch/types";

/**
 * The end of a video with autoplay on (player extras): "Up next" with the
 * next video and a ring counting down 8 seconds, then it plays. Cancel stops
 * it; the play button in the ring goes at once.
 */
export function AutoplayCountdown({
  video,
  channelName,
  onPlay,
  onCancel,
}: {
  video: UpNextVideo;
  channelName: string;
  onPlay: () => void;
  onCancel: () => void;
}) {
  const [started] = useState(() => Date.now());
  const [now, setNow] = useState(started);
  const left = secondsLeft(started, now);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    if (left === 0) onPlay();
  }, [left, onPlay]);

  // The ring empties smoothly over the countdown.
  const r = 30;
  const length = 2 * Math.PI * r;
  const done = Math.min(1, (now - started) / (AUTOPLAY_COUNTDOWN_S * 1000));

  return (
    <div
      data-autoplay-countdown={left}
      className="pp-fade-in absolute inset-x-0 top-0 bottom-[49px] z-20 flex flex-col items-center justify-center bg-black/75 px-4 text-center text-white"
    >
      <p className="text-[15px] text-[#cccccc]">
        Up next in <span data-autoplay-seconds>{left}</span>
      </p>
      <p className="mt-1 line-clamp-2 max-w-[440px] text-[20px] font-medium leading-[26px]">{video.title}</p>
      <p className="mt-1 text-[14px] text-[#cccccc]">{video.channelName ?? channelName}</p>
      <button
        type="button"
        aria-label={`Play ${video.title} now`}
        data-autoplay-now
        onClick={onPlay}
        className="mt-4 grid h-[72px] w-[72px] place-items-center"
      >
        <svg viewBox="0 0 72 72" className="absolute h-[72px] w-[72px] -rotate-90" aria-hidden>
          <circle cx="36" cy="36" r={r} fill="rgba(0,0,0,.4)" stroke="rgba(255,255,255,.3)" strokeWidth="4" />
          <circle
            cx="36"
            cy="36"
            r={r}
            fill="none"
            stroke="#fff"
            strokeWidth="4"
            strokeDasharray={length}
            strokeDashoffset={length * done}
          />
        </svg>
        <svg viewBox="0 0 24 24" className="relative h-8 w-8" aria-hidden>
          <path d="M8 5v14l11-7z" fill="currentColor" />
        </svg>
      </button>
      <button
        type="button"
        data-autoplay-cancel
        onClick={onCancel}
        className="mt-4 px-4 py-2 text-[14px] font-medium uppercase tracking-[0.5px] text-white hover:bg-white/10"
      >
        Cancel
      </button>
    </div>
  );
}

/**
 * The end screen with autoplay off (player extras): a 3 by 3 wall of videos
 * from Up next, each one a link, above the player's bottom bar.
 */
export function EndScreenWall({ videos, channelName }: { videos: UpNextVideo[]; channelName: string }) {
  return (
    <div
      data-end-screen={videos.length}
      className="pp-fade-in absolute inset-x-0 top-0 bottom-[49px] z-20 grid grid-cols-3 grid-rows-3 gap-1 bg-black p-1 sm:gap-2 sm:p-3"
    >
      {videos.map((v, i) => (
        <Link
          key={v.id}
          href={`/watch?v=${v.id}`}
          data-end-screen-video={v.id}
          // The tiles come up one after another, row by row.
          style={{ animationDelay: `${80 + i * 45}ms` }}
          className="pp-tile-in group/tile relative block min-h-0 overflow-hidden bg-[#222]"
        >
          {v.thumbnail && <Thumb src={v.thumbnail} alt="" sizes="(min-width: 1024px) 400px, 33vw" />}
          <span className="absolute inset-0 bg-gradient-to-b from-black/80 via-black/10 to-transparent opacity-90 transition-opacity group-hover/tile:opacity-100" />
          <span className="absolute inset-x-0 top-0 p-1.5 text-left text-white max-sm:hidden sm:p-2">
            <span className="line-clamp-2 text-[13px] font-medium leading-[17px]">{v.title}</span>
            <span className="mt-0.5 block truncate text-[12px] text-[#dddddd] opacity-0 transition-opacity group-hover/tile:opacity-100">
              {v.channelName ?? channelName} · {shortCount(v.views)} views
            </span>
          </span>
          {v.durationS !== null && (
            <span className="absolute bottom-1 right-1 bg-black/80 px-1 py-[3px] text-[12px] font-medium leading-3 text-white">
              {formatTime(v.durationS)}
            </span>
          )}
        </Link>
      ))}
    </div>
  );
}
