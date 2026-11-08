"use client";

import { useEffect } from "react";
import { useFlag } from "@/lib/store/session";
import { useWatch } from "@/lib/store/watch";

/**
 * Up next's Autoplay switch. With player extras it works and the browser
 * remembers it (on until switched off, like YouTube); without, it stays the
 * grey placeholder it was.
 */
export function AutoplaySwitch() {
  const extras = useFlag("player_extras");
  const on = useWatch((s) => s.autoplay);
  const setAutoplay = useWatch((s) => s.setAutoplay);
  const syncAutoplay = useWatch((s) => s.syncAutoplay);
  useEffect(() => syncAutoplay(), [syncAutoplay]);

  if (!extras) {
    return (
      <span
        title="Autoplay arrives in a later feature."
        className="flex cursor-not-allowed items-center gap-2 text-[13px] font-medium uppercase text-text-2"
      >
        Autoplay
        <span aria-hidden className="relative h-[14px] w-9 rounded-full bg-[var(--progress-track)]">
          <span className="absolute -top-[3px] left-0 h-5 w-5 rounded-full bg-[#bdbdbd] shadow" />
        </span>
      </span>
    );
  }

  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      data-autoplay-switch={on ? "on" : "off"}
      title="When autoplay is on, a suggested video plays next."
      onClick={() => setAutoplay(!on)}
      className="flex items-center gap-2 text-[13px] font-medium uppercase text-text-2 hover:text-text"
    >
      Autoplay
      <span aria-hidden className={`relative h-[14px] w-9 rounded-full transition-colors ${on ? "bg-[#065fd4]/40" : "bg-[var(--progress-track)]"}`}>
        <span
          className={`absolute -top-[3px] h-5 w-5 rounded-full shadow transition-[left,background-color] duration-150 ${
            on ? "left-4 bg-[#065fd4]" : "left-0 bg-[#bdbdbd]"
          }`}
        />
      </span>
    </button>
  );
}
