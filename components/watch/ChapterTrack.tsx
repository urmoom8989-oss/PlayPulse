"use client";

import type { Chapter } from "@/lib/watch/chapters";

/**
 * The progress line split into chapters with a 2 px gap between them, like
 * 2020 (player extras). Each part fills with what is buffered, the hover
 * position and what has played, and only the part under the mouse (or the
 * one being scrubbed) grows. Without chapters the player keeps its plain line.
 */
export function ChapterTrack({
  chapters,
  duration,
  time,
  buffered,
  hoverT,
  scrubbing,
}: {
  chapters: readonly Chapter[];
  duration: number;
  time: number;
  buffered: number;
  hoverT: number | null;
  scrubbing: boolean;
}) {
  if (!(duration > 0)) return null;
  const pct = (n: number) => `${Math.min(100, Math.max(0, (n / duration) * 100))}%`;
  const focus = hoverT ?? (scrubbing ? time : null);

  return (
    <div data-chapters={chapters.length} className="absolute inset-x-0 bottom-[7px] h-[3px]">
      {chapters.map((c, i) => {
        const start = c.start;
        const end = Math.min(duration, c.end ?? duration);
        const length = Math.max(0.001, end - start);
        const fill = (v: number) => `${Math.min(100, Math.max(0, ((v - start) / length) * 100))}%`;
        const big = focus !== null && focus >= start && (focus < end || i === chapters.length - 1);
        const last = i === chapters.length - 1;
        return (
          <div
            key={`${c.start}-${i}`}
            data-chapter-part={i}
            className={`absolute inset-y-0 origin-bottom bg-white/20 transition-transform ${big ? "scale-y-[1.67]" : ""}`}
            style={{ left: pct(start), width: last ? `calc(${pct(end - start)})` : `calc(${pct(end - start)} - 2px)` }}
          >
            <div className="absolute inset-y-0 left-0 bg-white/40" style={{ width: fill(buffered) }} />
            {hoverT !== null && <div className="absolute inset-y-0 left-0 bg-white/50" style={{ width: fill(hoverT) }} />}
            <div className="absolute inset-y-0 left-0 bg-[var(--mark)]" style={{ width: fill(time) }} />
          </div>
        );
      })}
    </div>
  );
}
