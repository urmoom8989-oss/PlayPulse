// Cards (041_cards.sql), the parts the browser, the server and the tests share.

export const CARDS_MAX = 5;
export const CARD_MESSAGE_MAX = 30;
/** How long a card's message stays out at the top right of the player. */
export const CARD_TEASER_MS = 5000;

export type CardKind = "video" | "channel" | "link";

/** A card as the uploader and the studio editor hold it while it is typed. */
export type CardDraft = { kind: CardKind; target: string; message: string; start: string };

/** A card as set_video_cards() takes it. */
export type CardPayload =
  | { kind: "video"; video_id: string; message: string; start_s: number }
  | { kind: "channel"; handle: string; message: string; start_s: number }
  | { kind: "link"; url: string; message: string; start_s: number };

/** A card as the player shows it (video_cards_for()). */
export type WatchCard = {
  id: string;
  kind: CardKind;
  message: string;
  startS: number;
  url: string | null;
  video: { id: string; title: string; thumbnail: string | null; durationS: number | null; views: number; channelName: string | null } | null;
  channel: { handle: string; name: string; avatarUrl: string | null; subscribers: number } | null;
};

export const KIND_LABELS: Record<CardKind, string> = { video: "Video", channel: "Channel", link: "Link" };
export const KIND_HINTS: Record<CardKind, string> = {
  video: "A video link or ID",
  channel: "A channel @handle",
  link: "A web address",
};

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/** "1:23", "83" or "1:02:03" in seconds; null when it is not a time. */
export function parseStart(text: string): number | null {
  const t = text.trim();
  if (t === "") return 0;
  if (/^\d{1,5}$/.test(t)) return Number(t);
  const m = /^(?:(\d{1,2}):)?(\d{1,3}):(\d{2})$/.exec(t);
  if (!m || Number(m[3]) > 59 || (m[1] !== undefined && Number(m[2]) > 59)) return null;
  return Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

/** Seconds as m:ss or h:mm:ss. */
export function formatStart(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** The video in a watch link, a Snips link or a bare ID. */
export function videoIdFrom(text: string): string | null {
  return UUID.exec(text.trim())?.[0].toLowerCase() ?? null;
}

/** A channel @handle, typed as @name, name or a channel link. */
export function handleFrom(text: string): string | null {
  const t = text.trim();
  const fromUrl = /\/@([A-Za-z0-9._-]{3,30})(?:[/?#]|$)/.exec(t)?.[1];
  const raw = fromUrl ?? t.replace(/^@/, "");
  return /^[A-Za-z0-9._-]{3,30}$/.test(raw) ? raw.toLowerCase() : null;
}

/** A web address, with https:// added when it was left out. */
export function linkFrom(text: string): string | null {
  const t = text.trim();
  if (!t || /\s/.test(t)) return null;
  const full = /^https?:\/\//i.test(t) ? t : /^[a-z][a-z0-9+.-]*:/i.test(t) ? null : `https://${t}`;
  if (!full || full.length > 2048) return null;
  try {
    const url = new URL(full);
    return (url.protocol === "http:" || url.protocol === "https:") && url.hostname.includes(".") ? url.href : null;
  } catch {
    return null;
  }
}

/** What is wrong with a card, or null. `durationS` checks the time against the video's length. */
export function cardProblem(d: CardDraft, durationS: number | null = null): string | null {
  if (d.kind === "video" && !videoIdFrom(d.target)) return "Paste a video link or ID";
  if (d.kind === "channel" && !handleFrom(d.target)) return "Type a channel @handle";
  if (d.kind === "link" && !linkFrom(d.target)) return "Type a web address";
  if (d.message.trim().length > CARD_MESSAGE_MAX) return `Up to ${CARD_MESSAGE_MAX} characters`;
  const start = parseStart(d.start);
  if (start === null) return "Use a time like 1:30";
  if (durationS !== null && durationS > 0 && start > durationS) return "That is after the video ends";
  return null;
}

/** The cards for set_video_cards(), or the first problem and which card it is on. */
export function toPayload(drafts: CardDraft[], durationS: number | null = null): { cards: CardPayload[] } | { error: string; index: number } {
  if (drafts.length > CARDS_MAX) return { error: `Up to ${CARDS_MAX} cards`, index: CARDS_MAX };
  const cards: CardPayload[] = [];
  for (const [index, d] of drafts.entries()) {
    const error = cardProblem(d, durationS);
    if (error) return { error, index };
    const base = { message: d.message.trim(), start_s: parseStart(d.start) ?? 0 };
    if (d.kind === "video") cards.push({ kind: "video", video_id: videoIdFrom(d.target) as string, ...base });
    else if (d.kind === "channel") cards.push({ kind: "channel", handle: handleFrom(d.target) as string, ...base });
    else cards.push({ kind: "link", url: linkFrom(d.target) as string, ...base });
  }
  return { cards };
}

/** A saved card back in the editor. */
export function draftFrom(card: WatchCard): CardDraft {
  const target =
    card.kind === "video" ? `/watch?v=${card.video?.id ?? ""}` : card.kind === "channel" ? `@${card.channel?.handle ?? ""}` : (card.url ?? "");
  return { kind: card.kind, target, message: card.message, start: formatStart(card.startS) };
}

/** A new, empty card. */
export function emptyCard(kind: CardKind = "video"): CardDraft {
  return { kind, target: "", message: "", start: "0:00" };
}

/** What the player shows for a card: its message, or else what it points at. */
export function cardTeaser(card: WatchCard): string {
  if (card.message) return card.message;
  if (card.video) return card.video.title;
  if (card.channel) return card.channel.name;
  try {
    return card.url ? new URL(card.url).hostname.replace(/^www\./, "") : "";
  } catch {
    return card.url ?? "";
  }
}

/** The cards whose time has come, newest last: the player shows the last one's message. */
export function cardsDue(cards: WatchCard[], timeS: number): WatchCard[] {
  return cards.filter((c) => c.startS <= timeS);
}

/** set_video_cards() errors in words. */
export function cardErrorText(code: string): string {
  switch (code) {
    case "too_many":
      return `Up to ${CARDS_MAX} cards`;
    case "video_not_found":
      return "One of the videos can't be found, or isn't public or unlisted";
    case "channel_not_found":
      return "One of the channels can't be found";
    case "bad_url":
      return "One of the web addresses doesn't work";
    case "bad_message":
      return `Messages can be up to ${CARD_MESSAGE_MAX} characters`;
    case "bad_time":
      return "One of the times doesn't work";
    case "not_owner":
      return "You can only add cards to your own videos";
    case "not_signed_in":
      return "Sign in to add cards";
    case "not_set_up":
      return "Cards aren't set up yet: run 041_cards.sql";
    default:
      return "Couldn't save the cards. Try again.";
  }
}

/** A row of video_cards_for() as the player uses it. */
export function readCard(r: Record<string, unknown>): WatchCard | null {
  const kind = r.kind;
  if (kind !== "video" && kind !== "channel" && kind !== "link") return null;
  const video =
    kind === "video" && typeof r.target_video_id === "string"
      ? {
          id: r.target_video_id,
          title: String(r.video_title ?? ""),
          thumbnail: typeof r.video_thumbnail_url === "string" ? r.video_thumbnail_url : null,
          durationS: r.video_duration_s === null || r.video_duration_s === undefined ? null : Number(r.video_duration_s),
          views: Number(r.video_views) || 0,
          channelName: typeof r.video_channel_name === "string" ? r.video_channel_name : null,
        }
      : null;
  const channel =
    kind === "channel" && typeof r.channel_handle === "string"
      ? {
          handle: r.channel_handle,
          name: String(r.channel_name ?? r.channel_handle),
          avatarUrl: typeof r.channel_avatar_url === "string" ? r.channel_avatar_url : null,
          subscribers: Number(r.channel_subscribers) || 0,
        }
      : null;
  if (kind === "video" && !video) return null;
  if (kind === "channel" && !channel) return null;
  if (kind === "link" && typeof r.url !== "string") return null;
  return {
    id: String(r.id),
    kind,
    message: String(r.message ?? ""),
    startS: Number(r.start_s) || 0,
    url: typeof r.url === "string" ? r.url : null,
    video,
    channel,
  };
}
