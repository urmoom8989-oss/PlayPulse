"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useFlag } from "@/lib/store/session";
import { PULL_MAX, PULL_TRIGGER, pullDistance, pullAllowed } from "@/lib/pull-refresh";

/**
 * Swipe down to refresh, on phones and tablets only (a touch screen without
 * hover), like the 2020 mobile app: at the top of the page, pull down and let
 * go past the line, a round arrow turns into a spinner and the page reloads.
 * The browser's own pull to refresh (and the bounce) is turned off while this
 * is on, so the two never both run. Desktop, the Snips feed (which swipes up
 * and down itself) and open dialogs are left alone. The pull_to_refresh flag.
 */
export function PullToRefresh() {
  const on = useFlag("pull_to_refresh");
  const path = usePathname();
  const [touch, setTouch] = useState(false);
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const start = useRef<{ x: number; y: number } | null>(null);
  const pulled = useRef(0);

  useEffect(() => {
    const media = window.matchMedia("(hover: none) and (pointer: coarse)");
    const update = () => setTouch(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  const active = on && touch && pullAllowed(path);

  useEffect(() => {
    if (!active) return;
    const root = document.documentElement;
    root.dataset.pullRefresh = "on";

    const down = (e: TouchEvent) => {
      const target = e.target instanceof Element ? e.target : null;
      const busy = document.body.style.overflow === "hidden" || target?.closest("[data-no-pull], dialog, [role=dialog], video, input, textarea");
      start.current = e.touches.length === 1 && window.scrollY <= 0 && !busy ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null;
      pulled.current = 0;
    };
    const move = (e: TouchEvent) => {
      const s = start.current;
      if (!s) return;
      const dy = e.touches[0].clientY - s.y;
      const dx = e.touches[0].clientX - s.x;
      // A sideways swipe, a push up, or the page scrolled after all: not a pull.
      if (window.scrollY > 0 || dy <= 0 || Math.abs(dx) > Math.abs(dy)) {
        if (pulled.current > 0) setPull((pulled.current = 0));
        if (dy < 0 || Math.abs(dx) > Math.abs(dy)) start.current = null;
        return;
      }
      pulled.current = pullDistance(dy);
      setPull(pulled.current);
    };
    const up = () => {
      if (!start.current) return;
      start.current = null;
      if (pulled.current >= PULL_TRIGGER) {
        setRefreshing(true);
        setPull(PULL_TRIGGER);
        window.location.reload();
      } else {
        setPull(0);
      }
      pulled.current = 0;
    };

    window.addEventListener("touchstart", down, { passive: true });
    window.addEventListener("touchmove", move, { passive: true });
    window.addEventListener("touchend", up, { passive: true });
    window.addEventListener("touchcancel", up, { passive: true });
    return () => {
      delete root.dataset.pullRefresh;
      window.removeEventListener("touchstart", down);
      window.removeEventListener("touchmove", move);
      window.removeEventListener("touchend", up);
      window.removeEventListener("touchcancel", up);
    };
  }, [active]);

  if (!active || (pull === 0 && !refreshing)) return null;
  const ready = pull >= PULL_TRIGGER;
  return (
    <div
      aria-hidden={!refreshing}
      role={refreshing ? "status" : undefined}
      data-pull-refresh={refreshing ? "refreshing" : ready ? "ready" : "pulling"}
      className="pointer-events-none fixed inset-x-0 top-14 z-40 flex justify-center"
      style={{ transform: `translateY(${pull - 44}px)`, transition: pull === PULL_TRIGGER || pull === 0 ? "transform 150ms" : undefined }}
    >
      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-surface shadow-[var(--menu-shadow)]">
        <svg
          viewBox="0 0 24 24"
          className={`h-6 w-6 text-brand ${refreshing ? "animate-spin" : ""}`}
          style={refreshing ? undefined : { transform: `rotate(${(pull / PULL_MAX) * 360}deg)`, opacity: Math.min(1, 0.35 + pull / PULL_TRIGGER) }}
        >
          {refreshing ? (
            <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeDasharray="34 50" />
          ) : (
            <path
              fill="currentColor"
              d="M17.65 6.35A7.96 7.96 0 0 0 12 4a8 8 0 1 0 7.73 10h-2.08A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"
            />
          )}
        </svg>
        {refreshing && <span className="sr-only">Refreshing</span>}
      </span>
    </div>
  );
}
