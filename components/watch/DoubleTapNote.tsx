"use client";

import type { TapSide } from "@/lib/watch/taps";

/** The double tap note's fade out (pp-scrim-out in globals.css), in ms. */
export const TAP_FADE_MS = 160;
/** The arrows light up one after another, this far apart (pp-tap-arrow in globals.css). */
const TAP_ARROW_STEP_MS = 150;

/**
 * What the note shows. `session` is the first skip of a run of taps (the arc
 * stays up while taps keep coming), `key` this tap (each tap gets its own
 * ripple), x and y where the finger was inside the arc, r how far the ripple
 * grows to fill it, and `leaving` while it fades out.
 */
export type TapNote = {
  side: TapSide;
  total: number;
  key: number;
  session: number;
  x: number;
  y: number;
  r: number;
  leaving: boolean;
};

/**
 * Double tap to skip on phones (player extras), like 2020: the arc on that
 * side fades in, a ripple grows from the finger on every tap, the three
 * arrows light up one after another toward the skip, "10 seconds" counts up
 * with the taps, and it all fades out. Key it by `session`, so a new run of
 * taps fades in again.
 */
export function DoubleTapNote({ note }: { note: TapNote }) {
  return (
    <div
      aria-hidden
      data-tap-skip={note.side}
      data-tap-state={note.leaving ? "leaving" : "on"}
      className={`pointer-events-none absolute inset-y-0 flex w-2/5 flex-col items-center justify-center overflow-hidden bg-white/10 text-white [text-shadow:0_0_4px_rgba(0,0,0,.75)] ${
        note.side === "back" ? "left-0 rounded-r-[50%]" : "right-0 rounded-l-[50%]"
      } ${note.leaving ? "pp-scrim-out" : "pp-scrim-in"}`}
    >
      <span
        key={note.key}
        data-tap-ripple
        className="pp-tap-ripple absolute rounded-full bg-white/30"
        style={{ left: note.x - note.r, top: note.y - note.r, width: note.r * 2, height: note.r * 2 }}
      />
      <span className={`relative flex ${note.side === "back" ? "-scale-x-100" : ""}`}>
        {[0, 1, 2].map((i) => (
          <svg
            key={i}
            viewBox="0 0 24 24"
            className="pp-tap-arrow -mx-1 h-5 w-5 drop-shadow-[0_0_3px_rgba(0,0,0,.75)]"
            style={{ animationDelay: `${i * TAP_ARROW_STEP_MS}ms` }}
            aria-hidden
          >
            <path d="M8 5v14l11-7z" fill="currentColor" />
          </svg>
        ))}
      </span>
      <span className="relative mt-1 text-[13px] font-medium" data-tap-total>
        {note.total} seconds
      </span>
    </div>
  );
}
