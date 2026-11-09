"use client";

import { useEffect } from "react";
import { useFlag } from "@/lib/store/session";
import { isSearchKey } from "@/lib/watch/shortcuts";

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return el.isContentEditable || tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

/** "/" puts the cursor in the search box on any page, like 2020 (the more_shortcuts flag). Renders nothing. */
export function SearchKey() {
  const on = useFlag("more_shortcuts");

  useEffect(() => {
    if (!on) return;
    const onKey = (e: KeyboardEvent) => {
      if (!isSearchKey(e, isTyping(e.target))) return;
      const box = Array.from(document.querySelectorAll<HTMLInputElement>('[data-search-box="bar"] input[role="combobox"]')).find(
        (el) => el.offsetParent !== null,
      );
      if (!box) return;
      e.preventDefault();
      box.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [on]);

  return null;
}
