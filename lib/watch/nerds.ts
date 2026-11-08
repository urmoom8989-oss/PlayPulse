// The right-click menu's links and the "Stats for nerds" box (player extras).
// Only imports format.ts, which has no imports, so the tests can load it.

import { startParam } from "./format.ts";

/** The watch page link, at a time when `atS` is 1 second or more: /watch?v=id&t=90. */
export function watchLink(origin: string, videoId: string, atS: number = 0): string {
  const base = `${origin.replace(/\/+$/, "")}/watch?v=${encodeURIComponent(videoId)}`;
  return Number.isFinite(atS) && atS >= 1 ? `${base}&t=${startParam(atS)}` : base;
}

/** What the box reads from the video element and hls.js, twice a second. */
export type NerdSnapshot = {
  videoId: string;
  viewport: { width: number; height: number; dpr: number };
  frames: { dropped: number; total: number } | null;
  current: { width: number; height: number; fps: number | null };
  optimal: { width: number; height: number; fps: number | null } | null;
  volume: number;
  muted: boolean;
  codecs: { video: string | null; audio: string | null };
  /** hls.js's estimate, in bits a second. Null in Safari or before it has one. */
  bandwidthBps: number | null;
  /** Seconds buffered ahead of the playhead. */
  bufferS: number;
  rate: number;
  /** "Auto (720p)", "480p", or "Picked by Safari". */
  quality: string;
  /** "hls.js 1.7.3" or "Safari (native HLS)". */
  engine: string;
};

function resolution(r: { width: number; height: number; fps: number | null }): string {
  const size = r.width > 0 && r.height > 0 ? `${r.width}x${r.height}` : "unknown";
  return r.fps && r.fps > 0 ? `${size}@${Math.round(r.fps)}` : size;
}

/** The rows of the box, label and value, in the order YouTube shows them. */
export function nerdRows(s: NerdSnapshot): [string, string][] {
  const frames = s.frames ? `${s.frames.dropped} dropped of ${s.frames.total}` : "not available";
  const volume = `${Math.round(Math.min(1, Math.max(0, s.volume)) * 100)}%${s.muted ? " (muted)" : ""}`;
  const speed =
    s.bandwidthBps !== null && Number.isFinite(s.bandwidthBps) && s.bandwidthBps > 0
      ? `${Math.round(s.bandwidthBps / 1000).toLocaleString("en-US")} Kbps`
      : "not measured yet";
  const buffer = Number.isFinite(s.bufferS) && s.bufferS > 0 ? s.bufferS : 0;
  return [
    ["Video ID", s.videoId],
    ["Viewport / Frames", `${Math.round(s.viewport.width)}x${Math.round(s.viewport.height)}*${s.viewport.dpr.toFixed(2)} / ${frames}`],
    ["Current / Optimal Res", `${resolution(s.current)} / ${s.optimal ? resolution(s.optimal) : "unknown"}`],
    ["Volume", volume],
    ["Codecs", `${s.codecs.video ?? "unknown"} / ${s.codecs.audio ?? "unknown"}`],
    ["Connection Speed", speed],
    ["Buffer Health", `${buffer.toFixed(2)} s`],
    ["Playback", `${s.rate}x, ${s.quality}`],
    ["Stream", s.engine],
  ];
}

/** Seconds buffered ahead of `t` in a video's buffered ranges. */
export function bufferAhead(ranges: { length: number; start(i: number): number; end(i: number): number }, t: number): number {
  for (let i = 0; i < ranges.length; i++) {
    if (ranges.start(i) <= t + 0.5 && ranges.end(i) >= t) return Math.max(0, ranges.end(i) - t);
  }
  return 0;
}
