// Premieres and live broadcasts made from an upload: where a broadcast is and
// what the page says about it. No imports, so Node can load this file directly.

export type BroadcastKind = "premiere" | "live";
export type BroadcastState = "upcoming" | "live" | "ended";

/** What the watch page and the cards know about a broadcast. */
export type Broadcast = {
  kind: BroadcastKind;
  /** When it starts (ISO). */
  at: string;
  state: BroadcastState;
  /** The viewer asked to be reminded (signed in only). */
  reminded: boolean;
  /** Watching now, or waiting before it starts. */
  viewers: number;
};

export function isBroadcastKind(v: unknown): v is BroadcastKind {
  return v === "premiere" || v === "live";
}

/** Same rule as broadcast_state() in 029_live.sql. */
export function broadcastState(atIso: string, durationS: number | null, nowMs: number): BroadcastState {
  const at = Date.parse(atIso);
  if (!Number.isFinite(at) || nowMs < at) return "upcoming";
  return nowMs < at + Math.max(0, durationS ?? 0) * 1000 ? "live" : "ended";
}

/** Seconds since the broadcast started (negative before). */
export function elapsedSeconds(atIso: string, nowMs: number): number {
  return (nowMs - Date.parse(atIso)) / 1000;
}

/**
 * The countdown, 2020 style: "2 days" or "1 day" while more than a day away,
 * else "1:05:09" or "4:59".
 */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const days = Math.floor(total / 86400);
  if (days >= 1) return `${days} day${days === 1 ? "" : "s"}`;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** "5 minutes", "1 hour", "2 days" for "Started streaming ... ago". */
export function roughDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const units: [number, string][] = [
    [86400, "day"],
    [3600, "hour"],
    [60, "minute"],
  ];
  for (const [size, name] of units) {
    if (s >= size) {
      const n = Math.floor(s / size);
      return `${n} ${name}${n === 1 ? "" : "s"}`;
    }
  }
  return `${s} second${s === 1 ? "" : "s"}`;
}

/** "Nov 9, 2026" or "Nov 9, 2026, 7:00 PM" in the viewer's time zone. */
export function formatWhen(atIso: string, withTime: boolean, locale = "en-US"): string {
  const d = new Date(atIso);
  return d.toLocaleString(locale, {
    month: "short",
    day: "numeric",
    year: "numeric",
    ...(withTime ? { hour: "numeric", minute: "2-digit" } : {}),
  });
}

/** The grey line under the title on the watch page. */
export function broadcastMeta(b: Pick<Broadcast, "kind" | "at" | "state" | "viewers">, nowMs: number): string {
  const n = b.viewers.toLocaleString("en-US");
  if (b.state === "upcoming") {
    const waiting = `${n} waiting`;
    return `${waiting} · ${b.kind === "premiere" ? "Premieres" : "Scheduled for"} ${formatWhen(b.at, true)}`;
  }
  if (b.state === "live") {
    const ago = roughDuration(elapsedSeconds(b.at, nowMs));
    return b.kind === "premiere"
      ? `${n} watching now · Premiere in progress. Started ${ago} ago`
      : `${n} watching now · Started streaming ${ago} ago`;
  }
  return b.kind === "premiere" ? `Premiered ${formatWhen(b.at, false)}` : `Streamed live on ${formatWhen(b.at, false)}`;
}

/** The badge on a card's thumbnail, or null once it is a normal video again. */
export function cardBadge(b: Pick<Broadcast, "kind" | "state">): { text: string; live: boolean } | null {
  if (b.state === "live") return { text: b.kind === "premiere" ? "PREMIERING NOW" : "LIVE NOW", live: true };
  if (b.state === "upcoming") return { text: b.kind === "premiere" ? "PREMIERE" : "UPCOMING", live: false };
  return null;
}

/**
 * The card's meta line instead of "views · ago" while upcoming or live.
 * Relative to `nowMs` (the server's clock, like the other card times).
 */
export function cardMeta(b: Pick<Broadcast, "kind" | "at" | "state" | "viewers">, nowMs: number): string | null {
  if (b.state === "live") return `${b.viewers.toLocaleString("en-US")} watching`;
  if (b.state === "upcoming") {
    const left = roughDuration((Date.parse(b.at) - nowMs) / 1000);
    return `${b.kind === "premiere" ? "Premieres" : "Live"} in ${left}`;
  }
  return null;
}

/** Is the player close enough to the live edge to show LIVE in red? */
export function atLiveEdge(currentTime: number, edge: number, slackS = 10): boolean {
  return Number.isFinite(edge) && edge - currentTime <= slackS;
}

/** Chat replay is fetched in windows of this many seconds of the broadcast. */
export const REPLAY_WINDOW_S = 60;

/** The replay window that holds second `t`: [from, to). */
export function replayWindow(t: number): { from: number; to: number } {
  const from = Math.max(0, Math.floor(Math.max(0, t) / REPLAY_WINDOW_S) * REPLAY_WINDOW_S);
  return { from, to: from + REPLAY_WINDOW_S };
}

/** Live chat polls this often while a broadcast is on. */
export const CHAT_POLL_MS = 2500;
/** Presence pings this often (a viewer counts for 30 seconds). */
export const PRESENCE_MS = 15000;
/** The chat keeps at most this many messages on screen. */
export const CHAT_KEEP = 150;

/** A line in the bell's list: an upload, or a broadcast that is coming, on, or over. */
export function notificationText(channel: string, title: string, b?: Pick<Broadcast, "kind" | "state"> | null): string {
  if (!b) return `${channel} uploaded: ${title}`;
  const premiere = b.kind === "premiere";
  if (b.state === "upcoming") return `${channel} scheduled ${premiere ? "a Premiere" : "a live stream"}: ${title}`;
  if (b.state === "live") return `${channel} ${premiere ? "is premiering" : "is live"}: ${title}`;
  return `${channel} ${premiere ? "premiered" : "was live"}: ${title}`;
}
