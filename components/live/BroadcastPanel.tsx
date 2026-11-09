"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { formatWhen, type BroadcastKind, type BroadcastState } from "@/lib/live/state";

type Panel = {
  options: { canGoLive: boolean; premieres: boolean; live: boolean };
  broadcast: { kind: BroadcastKind; at: string; state: BroadcastState } | null;
};

const ERRORS: Record<string, string> = {
  broadcast_off: "Premieres and live aren't on for your channel yet.",
  live_not_allowed: "This channel can't go live yet.",
  not_ready: "The video has to finish processing first.",
  already_started: "It has already started, so it can't be changed.",
  bad_time: "Pick a time between now and 30 days from now.",
  in_trash: "Restore the video first.",
  removed: "This video was removed.",
};

/** "2026-11-09T19:00" for a datetime-local input, an hour from `ms`, in the viewer's time zone. */
function localInput(ms: number): string {
  const d = new Date(ms + 3600_000);
  d.setSeconds(0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Studio > Video details > Premiere and live (028). Any channel can make a
 * ready video a Premiere at a set time; channels allowed to go live can also
 * stream it as a live broadcast, now or later. Before it starts it can be
 * cancelled. Shows nothing while neither flag is on.
 */
export function BroadcastPanel({ videoId, ready }: { videoId: string; ready: boolean }) {
  const [panel, setPanel] = useState<Panel | null>(null);
  const [when, setWhen] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  useEffect(() => {
    let gone = false;
    void fetch(`/api/live/schedule?v=${videoId}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((p: Panel | null) => {
        if (gone || !p) return;
        setPanel(p);
        setWhen(localInput(Date.now()));
      })
      .catch(() => {});
    return () => {
      gone = true;
    };
  }, [videoId]);

  if (!panel || (!panel.options.premieres && !(panel.options.live && panel.options.canGoLive))) return null;
  const canLive = panel.options.live && panel.options.canGoLive;

  async function schedule(kind: BroadcastKind, now: boolean) {
    setBusy(true);
    setMessage(null);
    const at = now ? null : when ? new Date(when).toISOString() : null;
    const res = await fetch("/api/live/schedule", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ videoId, kind, at }),
    }).catch(() => null);
    const json = (await res?.json().catch(() => null)) as { kind?: BroadcastKind; at?: string; error?: string } | null;
    setBusy(false);
    if (!res?.ok || !json?.kind || !json.at) {
      setMessage({ text: (json?.error && ERRORS[json.error]) || "Couldn't schedule that. Try again.", error: true });
      return;
    }
    const state: BroadcastState = Date.parse(json.at) <= Date.now() ? "live" : "upcoming";
    setPanel((p) => (p ? { ...p, broadcast: { kind: json.kind as BroadcastKind, at: json.at as string, state } } : p));
    setMessage({ text: state === "live" ? "You're live." : "Scheduled. The video is public, with a countdown until then.", error: false });
  }

  async function cancel() {
    setBusy(true);
    setMessage(null);
    const res = await fetch("/api/live/schedule", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ videoId }),
    }).catch(() => null);
    const json = (await res?.json().catch(() => null)) as { error?: string } | null;
    setBusy(false);
    if (!res?.ok) return setMessage({ text: (json?.error && ERRORS[json.error]) || "Couldn't cancel. Try again.", error: true });
    setPanel((p) => (p ? { ...p, broadcast: null } : p));
    setMessage({ text: "Cancelled. It's a normal video again.", error: false });
  }

  const b = panel.broadcast;
  const btn =
    "h-9 rounded-[2px] px-4 text-[14px] font-medium uppercase tracking-[0.007px] disabled:opacity-50";
  return (
    <div className="mt-6" data-broadcast-panel={b?.state ?? "none"}>
      <h2 className="mb-2 text-[15px] font-medium text-text">Premiere and live</h2>
      <div className="rounded-[2px] border border-divider bg-surface px-4 py-3 text-[13px] text-text">
        {b ? (
          <>
            <p data-broadcast-status>
              {b.state === "upcoming"
                ? `${b.kind === "premiere" ? "Premieres" : "Goes live"} ${formatWhen(b.at, true)}`
                : b.state === "live"
                  ? b.kind === "premiere"
                    ? "Premiering now"
                    : "Live now"
                  : b.kind === "premiere"
                    ? `Premiered ${formatWhen(b.at, false)}`
                    : `Streamed live on ${formatWhen(b.at, false)}`}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Link href={`/watch?v=${videoId}`} className={`${btn} inline-flex items-center bg-[var(--studio-accent)] text-white`}>
                Watch page
              </Link>
              {b.state === "upcoming" && (
                <button type="button" disabled={busy} onClick={() => void cancel()} className={`${btn} text-text-2 hover:bg-hover`}>
                  Cancel
                </button>
              )}
            </div>
          </>
        ) : !ready ? (
          <p className="text-text-2">When the video has finished processing you can premiere it{canLive ? " or go live with it" : ""}.</p>
        ) : (
          <>
            <p className="text-text-2">
              {canLive
                ? "Premiere this video at a set time, or stream it as a live broadcast, now or later. Viewers watch together with live chat."
                : "Premiere this video at a set time: a countdown page with reminders, then everybody watches together with live chat."}
            </p>
            <label className="mt-3 block text-text-2">
              Starts
              <input
                type="datetime-local"
                value={when}
                onChange={(e) => setWhen(e.target.value)}
                data-broadcast-when
                className="mt-1 block w-full rounded-[2px] border border-[var(--input-border)] bg-[var(--input-bg)] px-2 py-1.5 text-[14px] text-text"
              />
            </label>
            <div className="mt-3 flex flex-wrap gap-2">
              {panel.options.premieres && (
                <button
                  type="button"
                  disabled={busy || !when}
                  onClick={() => void schedule("premiere", false)}
                  data-schedule-premiere
                  className={`${btn} bg-[var(--studio-accent)] text-white`}
                >
                  Schedule Premiere
                </button>
              )}
              {canLive && (
                <>
                  <button type="button" disabled={busy || !when} onClick={() => void schedule("live", false)} className={`${btn} border border-divider text-text hover:bg-hover`}>
                    Schedule live
                  </button>
                  <button type="button" disabled={busy} onClick={() => void schedule("live", true)} data-go-live className={`${btn} bg-[#cc0000] text-white`}>
                    Go live now
                  </button>
                </>
              )}
            </div>
          </>
        )}
        {message && (
          <p role={message.error ? "alert" : "status"} className={`mt-2 ${message.error ? "text-[var(--error)]" : "text-text-2"}`}>
            {message.text}
          </p>
        )}
      </div>
    </div>
  );
}
