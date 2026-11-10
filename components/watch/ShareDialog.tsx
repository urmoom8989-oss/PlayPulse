"use client";

import { useEffect, useRef, useState } from "react";
import { CloseIcon, YapinIcon } from "@/components/icons";
import { useFlag } from "@/lib/store/session";
import { useWatch } from "@/lib/store/watch";
import { shareMessage, shareTarget } from "@/lib/yapin/rules";
import { formatTime, startParam } from "@/lib/watch/format";
import { SHARE_TARGETS, opensApp, shareUrl, type ShareTarget } from "@/lib/watch/share";

/** The round buttons of the 2020 share box, drawn in each site's colour. */
const TARGET_LOOK: Record<ShareTarget, { bg: string; icon: string }> = {
  email: { bg: "#888888", icon: "M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4-8 5-8-5V6l8 5 8-5v2z" },
  messages: { bg: "#34c759", icon: "M12 3C6.48 3 2 6.92 2 11.75c0 2.6 1.3 4.94 3.36 6.54L4.5 21.5l3.9-1.86c1.12.32 2.33.5 3.6.5 5.52 0 10-3.92 10-8.75S17.52 3 12 3z" },
  whatsapp: {
    bg: "#25d366",
    icon: "M12 2a9.9 9.9 0 0 0-8.53 14.93L2 22l5.2-1.42A9.9 9.9 0 1 0 12 2zm5.3 13.9c-.23.64-1.33 1.22-1.83 1.27-.47.05-1.06.07-1.71-.11a15.6 15.6 0 0 1-1.55-.57 12.1 12.1 0 0 1-4.66-4.12c-.36-.48-.86-1.28-.86-2.44 0-1.16.6-1.73.82-1.97.21-.23.47-.29.62-.29h.45c.15 0 .35-.06.54.41.2.48.68 1.66.74 1.78.06.12.1.26.02.42-.08.16-.12.26-.24.4l-.36.42c-.12.12-.25.25-.11.49.14.24.63 1.04 1.36 1.69.93.83 1.72 1.09 1.96 1.21.24.12.38.1.52-.06.14-.16.6-.7.76-.94.16-.24.32-.2.54-.12.22.08 1.4.66 1.64.78.24.12.4.18.46.28.06.1.06.58-.17 1.22z",
  },
  x: { bg: "#000000", icon: "M17.75 3h3.07l-6.7 7.66L22 21h-6.17l-4.83-6.32L5.47 21H2.4l7.17-8.2L2 3h6.33l4.37 5.78L17.75 3zm-1.08 16.17h1.7L7.4 4.74H5.58l11.09 14.43z" },
  facebook: { bg: "#1877f2", icon: "M14 8h2.5V4.5H14c-2.48 0-4 1.67-4 4.13V11H7.5v3.5H10V22h3.5v-7.5H16l.5-3.5h-3V8.75c0-.47.28-.75.5-.75z" },
  reddit: {
    bg: "#ff4500",
    icon: "M21 12.1a2.1 2.1 0 0 0-3.56-1.5 10.3 10.3 0 0 0-5.08-1.6l.86-4.04 2.8.6a1.5 1.5 0 1 0 .16-.74l-3.13-.67a.38.38 0 0 0-.45.29l-.96 4.55a10.3 10.3 0 0 0-5.16 1.6 2.1 2.1 0 1 0-2.31 3.43 4.1 4.1 0 0 0 0 .62c0 3.17 3.69 5.74 8.24 5.74s8.24-2.57 8.24-5.74a4.1 4.1 0 0 0 0-.62A2.1 2.1 0 0 0 21 12.1zM7.5 13.6a1.5 1.5 0 1 1 1.5 1.5 1.5 1.5 0 0 1-1.5-1.5zm8.39 3.97a5.53 5.53 0 0 1-3.89 1.21 5.53 5.53 0 0 1-3.89-1.21.38.38 0 0 1 .53-.53 4.79 4.79 0 0 0 3.36.99 4.79 4.79 0 0 0 3.36-.99.38.38 0 0 1 .53.53zM15 15.1a1.5 1.5 0 1 1 1.5-1.5 1.5 1.5 0 0 1-1.5 1.5z",
  },
};

/** The link to a video, with ?t= when a start time is given. */
export function shareLink(origin: string, videoId: string, startAt: number | null): string {
  const url = `${origin}/watch?v=${videoId}`;
  return startAt && startAt > 0 ? `${url}&t=${startParam(startAt)}` : url;
}

async function copyText(text: string, input: HTMLInputElement | null): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Older browsers, or no permission: select the field and copy that.
    if (!input) return false;
    input.select();
    try {
      return document.execCommand("copy");
    } catch {
      return false;
    }
  }
}

/**
 * The 2019 share box: the link, COPY, and "Start at" with the player's time.
 * `path` shares that address instead (Snips share /shorts/<id>), without
 * "Start at". With the yapin flag on (feature 16), a Yapin' button above the
 * link copies a message with the title and link and opens Yapin' to paste it.
 * The row of round buttons shares to email, messages and social sites, and
 * "More" opens the device's own share sheet where there is one.
 */
export function ShareDialog({ videoId, onClose, path, title = "" }: { videoId: string; onClose: () => void; path?: string; title?: string }) {
  const yapin = useFlag("yapin");
  const now = useWatch((s) => s.currentTime);
  // The time is taken when the box opens, like YouTube, so it does not run away.
  const [at] = useState(now);
  const [startOn, setStartOn] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // The box only opens in the browser, after a click.
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  // Phones (and some browsers) have their own share sheet: "More" opens it.
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  const link = path ? origin + path : shareLink(origin, videoId, startOn ? at : null);

  return (
    <>
      <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" onClick={onClose}>
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="share-title"
          data-share-dialog
          onClick={(e) => e.stopPropagation()}
          className="w-full max-w-[512px] rounded-[2px] bg-surface shadow-[var(--menu-shadow)]"
        >
          <div className="flex items-center justify-between px-6 pt-5">
            <h2 id="share-title" className="text-[16px] font-normal text-text">
              Share
            </h2>
            <button type="button" aria-label="Close" onClick={onClose} className="-mr-2 grid h-10 w-10 place-items-center text-icon">
              <CloseIcon className="h-6 w-6" />
            </button>
          </div>
          <div className="flex gap-2 overflow-x-auto px-4 pt-4 [scrollbar-width:none]" data-share-targets>
            {yapin && (
              <button
                type="button"
                data-share-yapin
                aria-label="Share to Yapin'"
                onClick={async () => {
                  // Open the tab first, while the click still counts, then copy.
                  const tab = window.open(shareTarget(title, link), "_blank", "noopener,noreferrer");
                  const copied = await copyText(shareMessage(title, link), null);
                  setToast(copied ? "Message copied. Paste it in Yapin'" : tab ? "Paste the link in Yapin'" : "Copy the link and paste it in Yapin'");
                }}
                className="flex w-[72px] flex-col items-center gap-2 rounded-[2px] py-1 text-[12px] text-text hover:bg-hover"
              >
                <YapinIcon className="h-[60px] w-[60px]" />
                Yapin&apos;
              </button>
            )}
            {SHARE_TARGETS.map(({ key, label }) => (
              <a
                key={key}
                href={shareUrl(key, link, title)}
                target={opensApp(key) ? undefined : "_blank"}
                rel="noopener noreferrer"
                data-share-to={key}
                aria-label={`Share to ${label}`}
                className="flex w-[72px] shrink-0 flex-col items-center gap-2 rounded-[2px] py-1 text-[12px] text-text hover:bg-hover"
              >
                <span className="grid h-[60px] w-[60px] place-items-center rounded-full" style={{ background: TARGET_LOOK[key].bg }}>
                  <svg viewBox="0 0 24 24" className="h-7 w-7" aria-hidden>
                    <path d={TARGET_LOOK[key].icon} fill="#fff" />
                  </svg>
                </span>
                {label}
              </a>
            ))}
            {canShare && (
              <button
                type="button"
                data-share-more
                aria-label="More ways to share"
                onClick={() => {
                  navigator.share({ title: title || undefined, url: link }).catch(() => undefined);
                }}
                className="flex w-[72px] shrink-0 flex-col items-center gap-2 rounded-[2px] py-1 text-[12px] text-text hover:bg-hover"
              >
                <span className="grid h-[60px] w-[60px] place-items-center rounded-full bg-[var(--hover)]">
                  <svg viewBox="0 0 24 24" className="h-7 w-7 text-icon" aria-hidden>
                    <path d="M6 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm12 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm-6 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4z" fill="currentColor" />
                  </svg>
                </span>
                More
              </button>
            )}
          </div>
          <div className="px-6 pb-4 pt-4">
            <div className="flex items-center gap-2 rounded-[2px] border border-divider bg-[var(--input-bg)] py-1 pl-3 pr-1">
              <input
                ref={inputRef}
                readOnly
                value={link}
                aria-label="Link to this video"
                data-share-link
                onFocus={(e) => e.currentTarget.select()}
                className="min-w-0 flex-1 bg-transparent text-[15px] text-text outline-none"
              />
              <button
                type="button"
                data-share-copy
                onClick={async () => {
                  if (await copyText(link, inputRef.current)) setToast("Link copied to clipboard");
                }}
                className="h-9 shrink-0 px-4 text-[14px] font-medium uppercase text-link hover:bg-hover"
              >
                Copy
              </button>
            </div>
          </div>
          {!path && (
          <label className="flex cursor-pointer items-center gap-3 border-t border-divider px-6 py-4 text-[14px] text-text">
            <input
              type="checkbox"
              checked={startOn}
              onChange={(e) => setStartOn(e.target.checked)}
              data-share-start
              className="h-4 w-4 accent-[var(--link)]"
            />
            Start at <span className="text-text-2">{formatTime(at)}</span>
          </label>
          )}
        </div>
      </div>
      {toast && (
        <div
          role="status"
          data-share-toast
          className="fixed bottom-6 left-6 z-[60] rounded-[2px] bg-[#323232] px-6 py-3.5 text-[14px] text-white shadow-lg"
        >
          {toast}
        </div>
      )}
    </>
  );
}
