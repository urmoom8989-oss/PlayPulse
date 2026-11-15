"use client";

import { useEffect, useRef, useState } from "react";
import { PLAY_MORPH_MS, morphEase, playPauseShape } from "@/lib/watch/morph";

// The play/pause button's icon: pause and play fold into each other like
// the 2020 player (the shapes are in lib/watch/morph.ts).

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** Pause while playing, play while paused; each change folds the shape over 200 ms. */
export function PlayPauseIcon({ playing, className = "" }: { playing: boolean; className?: string }) {
  const path = useRef<SVGPathElement>(null);
  // Where the shape is now (0 pause, 1 play): a change half way through folds back from there.
  const shown = useRef(playing ? 0 : 1);
  // React only draws the first shape; after that the effect moves the points.
  const [firstShape] = useState(() => playPauseShape(playing ? 0 : 1));

  useEffect(() => {
    const el = path.current;
    if (!el) return;
    const from = shown.current;
    const to = playing ? 0 : 1;
    if (from === to) return;
    if (reducedMotion()) {
      shown.current = to;
      el.setAttribute("d", playPauseShape(to));
      return;
    }
    const start = performance.now();
    const duration = PLAY_MORPH_MS * Math.abs(to - from);
    let frame = 0;
    const step = (now: number) => {
      const t = Math.min(1, Math.max(0, (now - start) / duration));
      shown.current = from + (to - from) * morphEase(t);
      el.setAttribute("d", playPauseShape(shown.current));
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [playing]);

  return (
    <svg viewBox="0 0 36 36" className={className} aria-hidden data-play-icon={playing ? "pause" : "play"}>
      <path ref={path} d={firstShape} fill="currentColor" />
    </svg>
  );
}
