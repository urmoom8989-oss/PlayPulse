"use client";

import type Hls from "hls.js";
import { useEffect, useState, type RefObject } from "react";
import { bufferAhead, nerdRows, type NerdSnapshot } from "@/lib/watch/nerds";

type Level = Hls["levels"][number];

/** How often the numbers refresh, in milliseconds. */
const REFRESH_MS = 500;

function read(
  videoId: string,
  video: HTMLVideoElement,
  hls: Hls | null,
  engine: string,
  quality: string,
  playingLevel: number,
): NerdSnapshot {
  const levels: Level[] = hls?.levels ?? [];
  const level: Level | undefined = playingLevel >= 0 ? levels[playingLevel] : undefined;
  const best = levels.reduce<Level | undefined>((a, l) => (!a || l.width * l.height > a.width * a.height ? l : a), undefined);
  const q = typeof video.getVideoPlaybackQuality === "function" ? video.getVideoPlaybackQuality() : null;
  const rect = video.getBoundingClientRect();
  const estimate = hls ? hls.bandwidthEstimate : NaN;
  return {
    videoId,
    viewport: { width: rect.width, height: rect.height, dpr: window.devicePixelRatio || 1 },
    frames: q ? { dropped: q.droppedVideoFrames, total: q.totalVideoFrames } : null,
    current: { width: video.videoWidth, height: video.videoHeight, fps: level?.frameRate || null },
    optimal: best ? { width: best.width, height: best.height, fps: best.frameRate || null } : null,
    volume: video.volume,
    muted: video.muted,
    codecs: { video: level?.videoCodec ?? null, audio: level?.audioCodec ?? null },
    bandwidthBps: Number.isFinite(estimate) && estimate > 0 ? estimate : null,
    bufferS: bufferAhead(video.buffered, video.currentTime),
    rate: video.playbackRate,
    quality,
    engine,
  };
}

/**
 * The "Stats for nerds" box from the right-click menu (player extras): what
 * the video element and hls.js know, refreshed twice a second, with [x] to
 * close it. Safari plays HLS itself, so codecs and speed are unknown there.
 */
export function StatsForNerds({
  videoId,
  videoRef,
  hlsRef,
  engine,
  quality,
  playingLevel,
  onClose,
}: {
  videoId: string;
  videoRef: RefObject<HTMLVideoElement | null>;
  hlsRef: RefObject<Hls | null>;
  engine: string;
  quality: string;
  playingLevel: number;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<[string, string][]>([]);

  useEffect(() => {
    const tick = () => {
      const video = videoRef.current;
      if (video) setRows(nerdRows(read(videoId, video, hlsRef.current, engine, quality, playingLevel)));
    };
    tick();
    const id = setInterval(tick, REFRESH_MS);
    return () => clearInterval(id);
  }, [videoId, videoRef, hlsRef, engine, quality, playingLevel]);

  return (
    <div
      role="dialog"
      aria-label="Stats for nerds"
      data-stats-for-nerds
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.stopPropagation()}
      className="absolute left-2.5 top-2.5 z-30 max-h-[calc(100%-60px)] max-w-[calc(100%-20px)] overflow-auto rounded-[2px] bg-[rgba(28,28,28,0.8)] py-2 pl-3 pr-8 text-[11px] leading-[16px] text-white"
    >
      <button
        type="button"
        aria-label="Close stats for nerds"
        onClick={onClose}
        className="absolute right-2 top-1.5 font-mono text-[11px] text-[#eeeeee] hover:text-white"
      >
        [x]
      </button>
      <table>
        <tbody>
          {rows.map(([label, value]) => (
            <tr key={label}>
              <th scope="row" className="whitespace-nowrap pr-2 text-right align-top font-bold">
                {label}
              </th>
              <td className="break-all align-top">{value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
