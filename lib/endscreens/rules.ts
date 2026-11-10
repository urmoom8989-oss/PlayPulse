// End screens (045_end_screens.sql): the rules the uploader, the studio
// editor, the player and the tests share. Only relative imports, so Node can
// load it directly.

import { cardMedia } from "../feed/types.ts";

export type EndKind = "subscribe" | "video" | "channel";

/** One element while it is being edited. x and y: the top left corner, as a share of the player. */
export type EndDraft = { kind: EndKind; videoId: string; handle: string; x: number; y: number; showS: number };

/** What set_video_end_screen() takes. */
export type EndPayload =
  | { kind: "subscribe"; x: number; y: number; show_s: number }
  | { kind: "video"; video_id: string; x: number; y: number; show_s: number }
  | { kind: "channel"; handle: string; x: number; y: number; show_s: number };

/** One element on the player, with what it points at. */
export type EndElement = {
  id: string;
  kind: EndKind;
  x: number;
  y: number;
  showS: number;
  video: { id: string; title: string; thumbnail: string; durationS: number | null; views: number; channelName: string } | null;
  channel: { id: string; handle: string; name: string; avatarUrl: string | null; subscribers: number } | null;
};

export const END_MAX = 4;
export const END_SHOW_MIN = 5;
export const END_SHOW_MAX = 20;

/** Each kind's size, as a share of the player's width and height (a 16:9 player). */
export const END_SIZES: Record<EndKind, { w: number; h: number }> = {
  video: { w: 0.32, h: 0.32 },
  subscribe: { w: 0.14, h: 0.14 * (16 / 9) },
  channel: { w: 0.14, h: 0.14 * (16 / 9) },
};

export const END_LABELS: Record<EndKind, string> = { subscribe: "Subscribe", video: "Video", channel: "Channel" };

/** Where new elements go, in this order, the first free one. */
const SPOTS: Record<EndKind, { x: number; y: number }[]> = {
  video: [
    { x: 0.06, y: 0.34 },
    { x: 0.42, y: 0.34 },
    { x: 0.06, y: 0.04 },
    { x: 0.42, y: 0.04 },
  ],
  subscribe: [
    { x: 0.78, y: 0.36 },
    { x: 0.78, y: 0.06 },
    { x: 0.78, y: 0.66 },
  ],
  channel: [
    { x: 0.78, y: 0.06 },
    { x: 0.78, y: 0.66 },
    { x: 0.78, y: 0.36 },
    { x: 0.42, y: 0.66 },
  ],
};

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** Keeps the element inside the player. */
export function clampPlace(kind: EndKind, x: number, y: number): { x: number; y: number } {
  const { w, h } = END_SIZES[kind];
  const cx = Number.isFinite(x) ? x : 0;
  const cy = Number.isFinite(y) ? y : 0;
  return { x: round3(Math.min(Math.max(cx, 0), 1 - w)), y: round3(Math.min(Math.max(cy, 0), 1 - h)) };
}

type Box = { kind: EndKind; x: number; y: number };

/** Two elements cover each other. */
export function overlaps(a: Box, b: Box): boolean {
  const A = END_SIZES[a.kind];
  const B = END_SIZES[b.kind];
  const eps = 0.001;
  return a.x < b.x + B.w - eps && b.x < a.x + A.w - eps && a.y < b.y + B.h - eps && b.y < a.y + A.h - eps;
}

/** A new element of this kind, in the first free spot. */
export function newElement(kind: EndKind, existing: Box[]): EndDraft {
  const spot = SPOTS[kind].find((s) => !existing.some((e) => overlaps({ kind, ...s }, e))) ?? SPOTS[kind][0];
  return { kind, videoId: "", handle: "", ...clampPlace(kind, spot.x, spot.y), showS: END_SHOW_MAX };
}

/** What is wrong with one element, or null. */
export function elementProblem(d: EndDraft): string | null {
  if (d.kind === "video" && !d.videoId) return "Pick a video.";
  if (d.kind === "channel" && !/^@?[A-Za-z0-9._-]{3,30}$/.test(d.handle.trim())) return "Enter a channel's @handle.";
  if (!Number.isInteger(d.showS) || d.showS < END_SHOW_MIN || d.showS > END_SHOW_MAX) return "Pick 5 to 20 seconds.";
  return null;
}

/** What is wrong with the whole end screen, or null. */
export function endProblem(ds: EndDraft[]): string | null {
  if (ds.length > END_MAX) return `Up to ${END_MAX} elements.`;
  if (ds.filter((d) => d.kind === "subscribe").length > 1) return "Only one subscribe element.";
  for (let i = 0; i < ds.length; i++) {
    for (let j = i + 1; j < ds.length; j++) {
      if (overlaps(ds[i], ds[j])) return `Elements ${i + 1} and ${j + 1} overlap. Drag one of them aside.`;
    }
  }
  const bad = ds.findIndex((d) => elementProblem(d) !== null);
  return bad >= 0 ? `Element ${bad + 1}: ${elementProblem(ds[bad])}` : null;
}

export function toEndPayload(d: EndDraft): EndPayload {
  const { x, y } = clampPlace(d.kind, d.x, d.y);
  if (d.kind === "video") return { kind: "video", video_id: d.videoId, x, y, show_s: d.showS };
  if (d.kind === "channel") return { kind: "channel", handle: d.handle.trim().replace(/^@/, ""), x, y, show_s: d.showS };
  return { kind: "subscribe", x, y, show_s: d.showS };
}

export function draftFromElement(e: EndElement): EndDraft {
  return { kind: e.kind, videoId: e.video?.id ?? "", handle: e.channel && e.kind === "channel" ? `@${e.channel.handle}` : "", x: e.x, y: e.y, showS: e.showS };
}

/** The elements on screen at `time` of a `duration` long video: each for its last showS seconds. */
export function elementsDue<T extends { showS: number }>(els: readonly T[], time: number, duration: number): T[] {
  if (!(duration > 0) || time >= duration) return [];
  return els.filter((e) => duration - time <= e.showS);
}

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

function isKind(v: unknown): v is EndKind {
  return v === "subscribe" || v === "video" || v === "channel";
}

/** A video_end_screen() row, or null when it is not one. */
export function readEndElement(r: Record<string, unknown>, publicBase: string | null): EndElement | null {
  if (!isKind(r.kind) || typeof r.id !== "string") return null;
  const video =
    r.kind === "video" && typeof r.target_video_id === "string"
      ? {
          id: r.target_video_id,
          title: String(r.video_title ?? ""),
          thumbnail: cardMedia(
            {
              id: r.target_video_id,
              thumbnailUrl: typeof r.video_thumbnail_url === "string" ? r.video_thumbnail_url : null,
              hlsKey: typeof r.video_hls_key === "string" ? r.video_hls_key : null,
              spriteKey: null,
            },
            publicBase,
          ).thumbnail,
          durationS: r.video_duration_s === null || r.video_duration_s === undefined ? null : num(r.video_duration_s),
          views: num(r.video_views),
          channelName: String(r.video_channel_name ?? ""),
        }
      : null;
  const channel =
    r.kind !== "video" && typeof r.channel_id === "string"
      ? {
          id: r.channel_id,
          handle: String(r.channel_handle ?? ""),
          name: String(r.channel_name ?? ""),
          avatarUrl: typeof r.channel_avatar_url === "string" ? r.channel_avatar_url : null,
          subscribers: num(r.channel_subscribers),
        }
      : null;
  if (r.kind === "video" && !video) return null;
  if (r.kind !== "video" && !channel) return null;
  const kind = r.kind;
  return { id: r.id, kind, ...clampPlace(kind, num(r.x), num(r.y)), showS: Math.min(END_SHOW_MAX, Math.max(END_SHOW_MIN, Math.round(num(r.show_s)) || END_SHOW_MAX)), video, channel };
}

/** set_video_end_screen() errors in words. */
export function endErrorText(code: string): string {
  switch (code) {
    case "too_many":
      return `Up to ${END_MAX} elements.`;
    case "two_subscribes":
      return "Only one subscribe element.";
    case "bad_place":
      return "An element is outside the player.";
    case "bad_time":
      return "Pick 5 to 20 seconds for each element.";
    case "video_not_found":
      return "One of the videos can't be found, or it's private.";
    case "channel_not_found":
      return "One of the channels can't be found. Check the @handle.";
    case "not_owner":
      return "This isn't your video.";
    case "off":
      return "End screens are switched off right now.";
    case "not_set_up":
      return "End screens aren't set up yet: run 045_end_screens.sql.";
    default:
      return "The end screen didn't save. Try again.";
  }
}
