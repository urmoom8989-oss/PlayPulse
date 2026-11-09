"use client";

import { useEffect, useRef, useState } from "react";
import { useFlag } from "@/lib/store/session";
import { isSearchKey, isShortcutsKey, OPEN_SHORTCUTS_EVENT, SHORTCUT_GROUPS } from "@/lib/watch/shortcuts";

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return el.isContentEditable || tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

/**
 * The 2020 "Keyboard shortcuts" dialog, on every page: Shift+? opens it, and
 * so does Keyboard shortcuts in the account and settings menus. "/" jumps to
 * the search box. Both only with the more_shortcuts flag.
 */
export function ShortcutsDialog() {
  const on = useFlag("more_shortcuts");
  const [open, setOpen] = useState(false);
  const dismiss = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!on) return;
    const onKey = (e: KeyboardEvent) => {
      const typing = isTyping(e.target);
      if (isShortcutsKey(e, typing)) {
        e.preventDefault();
        setOpen(true);
      } else if (isSearchKey(e, typing)) {
        const box = Array.from(document.querySelectorAll<HTMLInputElement>('[data-search-box="bar"] input[role="combobox"]')).find(
          (el) => el.offsetParent !== null,
        );
        if (!box) return;
        e.preventDefault();
        box.focus();
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_SHORTCUTS_EVENT, onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_SHORTCUTS_EVENT, onOpen);
    };
  }, [on]);

  useEffect(() => {
    if (!open) return;
    dismiss.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!on || !open) return null;

  return (
    <div className="fixed inset-0 z-[70] grid place-items-center bg-black/50 p-4" onClick={() => setOpen(false)}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-title"
        data-shortcuts-dialog
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[calc(100vh-32px)] w-full max-w-[880px] flex-col rounded-[2px] bg-surface shadow-[var(--menu-shadow)]"
      >
        <h2 id="shortcuts-title" className="px-6 pb-2 pt-6 text-[20px] font-normal text-text">
          Keyboard shortcuts
        </h2>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-2 md:columns-2 md:gap-12">
          {SHORTCUT_GROUPS.map((g) => (
            <section key={g.title} className="mb-4 break-inside-avoid">
              <h3 className="py-2 text-[14px] font-medium text-text">{g.title}</h3>
              <dl>
                {g.items.map((s) => (
                  <div key={s.label} className="flex items-start justify-between gap-6 py-1.5 text-[14px] leading-5">
                    <dt className="text-text-2">{s.label}</dt>
                    <dd className="flex shrink-0 gap-1">
                      {s.keys.map((k) => (
                        <kbd key={k} className="min-w-6 rounded-[2px] bg-[var(--active)] px-1.5 text-center font-[inherit] text-[13px] text-text">
                          {k}
                        </kbd>
                      ))}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
        <div className="flex justify-end border-t border-divider px-4 py-2">
          <button
            ref={dismiss}
            type="button"
            onClick={() => setOpen(false)}
            className="h-9 px-4 text-[14px] font-medium uppercase text-link hover:bg-hover"
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}

/** Opens the dialog from a menu item. */
export function openShortcuts() {
  window.dispatchEvent(new Event(OPEN_SHORTCUTS_EVENT));
}
