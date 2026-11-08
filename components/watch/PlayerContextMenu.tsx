"use client";

import { useEffect, useRef, type ComponentType } from "react";
import { CheckIcon, InfoIcon, LinkIcon, LoopIcon, ScheduleIcon } from "@/components/icons";

/** About the size of the menu, to keep it inside the player. */
const MENU_W = 264;
const MENU_H = 4 * 40 + 16;

/** Where to put the menu so it stays inside a player of `width` by `height`. */
export function menuPosition(x: number, y: number, width: number, height: number): { left: number; top: number } {
  return {
    left: Math.max(4, Math.min(x, width - MENU_W - 4)),
    top: Math.max(4, Math.min(y, height - MENU_H - 4)),
  };
}

/**
 * The player's right-click menu, like 2020 (player extras): Loop, Copy video
 * URL, Copy video URL at current time and Stats for nerds. Closes on a click
 * elsewhere, Escape or a choice. A second right-click while it is open shows
 * the browser's own menu, like YouTube.
 */
export function PlayerContextMenu({
  left,
  top,
  loop,
  onLoop,
  onCopy,
  onCopyAtTime,
  onStats,
  onClose,
}: {
  left: number;
  top: number;
  loop: boolean;
  onLoop: () => void;
  onCopy: () => void;
  onCopyAtTime: () => void;
  onStats: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
    const onDown = (e: PointerEvent) => {
      if (e.button === 2) return;
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("blur", onClose);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);

  const pick = (action: () => void) => () => {
    action();
    onClose();
  };

  return (
    <div
      ref={ref}
      role="menu"
      aria-label="Player menu"
      data-player-context-menu
      onContextMenu={(e) => e.stopPropagation()}
      className="absolute z-30 rounded-[2px] bg-[rgba(28,28,28,0.9)] py-2 text-[13px] font-medium text-[#eeeeee] [text-shadow:0_0_2px_rgba(0,0,0,.5)]"
      style={{ left, top, width: MENU_W }}
    >
      <Item Icon={LoopIcon} label="Loop" onClick={pick(onLoop)} checked={loop} data-menu-loop />
      <Item Icon={LinkIcon} label="Copy video URL" onClick={pick(onCopy)} data-menu-copy />
      <Item Icon={ScheduleIcon} label="Copy video URL at current time" onClick={pick(onCopyAtTime)} data-menu-copy-time />
      <Item Icon={InfoIcon} label="Stats for nerds" onClick={pick(onStats)} data-menu-stats />
    </div>
  );
}

function Item({
  Icon,
  label,
  onClick,
  checked,
  ...rest
}: {
  Icon: ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
  checked?: boolean;
} & Record<`data-${string}`, unknown>) {
  const toggle = checked !== undefined;
  return (
    <button
      type="button"
      role={toggle ? "menuitemcheckbox" : "menuitem"}
      aria-checked={toggle ? checked : undefined}
      onClick={onClick}
      className="flex h-10 w-full items-center gap-4 px-4 text-left outline-none hover:bg-white/10 focus-visible:bg-white/10"
      {...rest}
    >
      <Icon className="h-6 w-6 shrink-0" />
      <span className="flex-1 truncate">{label}</span>
      {toggle && checked && <CheckIcon className="h-5 w-5 shrink-0" />}
    </button>
  );
}
