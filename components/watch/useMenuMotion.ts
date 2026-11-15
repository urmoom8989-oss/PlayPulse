"use client";

import { useCallback, useLayoutEffect, useRef } from "react";

// The settings menu's motion, like the 2020 player: going into a page (Quality,
// Playback speed, Subtitles/CC...) slides the new page in from the right while
// the old one slides out to the left, and Back does the opposite; the menu's
// box grows or shrinks to the new page at the same time. Opening fades it in,
// closing fades it out.
//
// The outgoing page is a copy of its DOM taken just before the change (so it
// shows exactly what was on screen), parked in an empty element React never
// touches, and removed when its slide ends. No state changes, so the menu
// itself renders as before.

/** How long a page change takes, in ms (the 2020 player's 250 ms). */
export const MENU_SLIDE_MS = 250;
/** Opening and closing fades, in ms. */
export const MENU_FADE_MS = 100;
const EASE = "cubic-bezier(0.4, 0, 0.2, 1)";

type Snapshot<K> = { from: K | null; to: K | null; w: number; h: number; ghost: HTMLElement | null; scroll: number };

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** A copy that looks the same but is not part of the page: no role, no data-*, no focus, no clicks. */
function asGhost(el: HTMLElement) {
  for (const name of el.getAttributeNames()) if (name === "role" || name === "id" || name.startsWith("data-") || name.startsWith("aria-")) el.removeAttribute(name);
  el.setAttribute("aria-hidden", "true");
  el.setAttribute("inert", "");
  el.style.pointerEvents = "none";
  return el;
}

/**
 * For a menu whose open page is `menu` (null when closed). `depth` says how
 * deep a page is, so a change to a deeper page slides forward and to a
 * shallower one slides back. Call `before(next)` just before changing the page.
 */
export function useMenuMotion<K extends string>(menu: K | null, depth: (k: K) => number) {
  /** The menu's box. */
  const boxRef = useRef<HTMLDivElement>(null);
  /** The page in the box (keyed by page, so each page is its own element). */
  const panelRef = useRef<HTMLDivElement>(null);
  /** An empty element in the box where the outgoing page slides away. */
  const ghostRef = useRef<HTMLDivElement>(null);
  /** An empty element outside the box where a closing menu fades out. */
  const closeRef = useRef<HTMLDivElement>(null);
  const shown = useRef<K | null>(menu);
  const pending = useRef<Snapshot<K> | null>(null);

  const before = useCallback((next: K | null) => {
    if (pending.current) {
      pending.current.to = next;
      return;
    }
    const from = shown.current;
    if (next === from) return;
    const box = boxRef.current;
    const panel = panelRef.current;
    if (from === null || !box || !panel) {
      pending.current = { from, to: next, w: 0, h: 0, ghost: null, scroll: 0 };
      return;
    }
    pending.current = {
      from,
      to: next,
      w: box.offsetWidth,
      h: box.offsetHeight,
      ghost: (next === null ? box : panel).cloneNode(true) as HTMLElement,
      scroll: panel.scrollTop,
    };
  }, []);

  useLayoutEffect(() => {
    const p = pending.current;
    pending.current = null;
    shown.current = menu;
    if (!p || p.to !== menu || p.from === menu || reducedMotion()) return;

    // Closed: the copy of the menu fades out where it was.
    if (menu === null) {
      const host = closeRef.current;
      const ghost = p.ghost;
      if (!host || !ghost) return;
      host.appendChild(asGhost(ghost));
      ghost.animate([{ opacity: 1 }, { opacity: 0 }], { duration: MENU_FADE_MS, easing: "linear", fill: "forwards" }).onfinish = () => ghost.remove();
      return;
    }

    const box = boxRef.current;
    const panel = panelRef.current;
    if (!box || !panel) return;

    // Opened: a quick fade in.
    if (p.from === null) {
      box.animate([{ opacity: 0 }, { opacity: 1 }], { duration: MENU_FADE_MS, easing: "linear" });
      return;
    }

    // Another page: the box resizes from the old page's size to the new one's, and the pages slide.
    for (const a of box.getAnimations()) a.cancel();
    const w = box.offsetWidth;
    const h = box.offsetHeight;
    const dir = depth(menu) > depth(p.from) ? 1 : -1;
    const timing = { duration: MENU_SLIDE_MS, easing: EASE };
    box.animate([{ width: `${p.w}px`, height: `${p.h}px` }, { width: `${w}px`, height: `${h}px` }], timing);
    panel.animate([{ transform: `translateX(${dir * 100}%)` }, { transform: "translateX(0)" }], timing);

    const host = ghostRef.current;
    const ghost = p.ghost;
    if (!host || !ghost) return;
    asGhost(ghost);
    Object.assign(ghost.style, { position: "absolute", left: "0", top: "0", width: `${p.w}px` });
    host.appendChild(ghost);
    ghost.scrollTop = p.scroll;
    ghost.animate([{ transform: "translateX(0)" }, { transform: `translateX(${-dir * 100}%)` }], { ...timing, fill: "forwards" }).onfinish = () =>
      ghost.remove();
  }, [menu, depth]);

  return { boxRef, panelRef, ghostRef, closeRef, before };
}
