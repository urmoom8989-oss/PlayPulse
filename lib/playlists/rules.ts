// Playlists (043_playlists.sql): the parts the Save dialog, the playlist page,
// the watch page's panel and the tests share. Only relative imports, so Node
// can load it directly.

import { cardMedia, rowToCard, type FeedCard, type FeedRow } from "../feed/types.ts";

export type PlaylistVisibility = "public" | "unlisted" | "private";
export type PlaylistKind = "playlist" | "watch_later";

export const PLAYLIST_TITLE_MAX = 150;
export const PLAYLIST_DESCRIPTION_MAX = 5000;
/** The playlist page and the panel next to the player list this many videos. */
export const PLAYLIST_SHOWN = 200;

export const PLAYLIST_VISIBILITIES: { value: PlaylistVisibility; label: string; hint: string }[] = [
  { value: "public", label: "Public", hint: "Anyone can search for and view" },
  { value: "unlisted", label: "Unlisted", hint: "Anyone with the link can view" },
  { value: "private", label: "Private", hint: "Only you can view" },
];

/** One of your playlists, for the Save dialog, the guide and the library. */
export type PlaylistSummary = {
  id: string;
  kind: PlaylistKind;
  title: string;
  visibility: PlaylistVisibility;
  count: number;
  /** The video the Save dialog was opened for is in it. */
  hasVideo: boolean;
  updatedAt: string;
  firstVideoId: string | null;
  thumbnail: string | null;
};

/** The top of the playlist page and the panel's header. */
export type PlaylistHeader = {
  id: string;
  kind: PlaylistKind;
  title: string;
  description: string;
  visibility: PlaylistVisibility;
  updatedAt: string;
  isOwner: boolean;
  owner: { name: string; handle: string | null; avatarUrl: string | null };
  /** Videos the viewer can watch. */
  count: number;
  /** Videos in it the viewer can't watch (private or gone): "1 unavailable video is hidden". */
  hidden: number;
  firstVideoId: string | null;
  thumbnail: string | null;
};

export type PlaylistItem = FeedCard & { position: number };

export function isPlaylistVisibility(v: unknown): v is PlaylistVisibility {
  return v === "public" || v === "unlisted" || v === "private";
}

/** What is wrong with a playlist title, or null. */
export function titleProblem(title: string): string | null {
  const t = title.trim();
  if (!t) return "Your playlist needs a name.";
  if (t.length > PLAYLIST_TITLE_MAX) return `Up to ${PLAYLIST_TITLE_MAX} characters.`;
  return null;
}

/** The playlist page, the 2020 address. */
export function playlistHref(listId: string): string {
  return `/playlist?list=${encodeURIComponent(listId)}`;
}

/** A video played from a playlist: the panel shows next to the player. */
export function watchInList(videoId: string, listId: string): string {
  return `/watch?v=${encodeURIComponent(videoId)}&list=${encodeURIComponent(listId)}`;
}

/** Where the video is in the list, 1 based, or 0 when it is not in it. */
export function positionOf(items: readonly { id: string }[], videoId: string): number {
  return items.findIndex((v) => v.id === videoId) + 1;
}

/** The video after this one in the list; null at the end or when it is not in it. */
export function nextInList<T extends { id: string }>(items: readonly T[], videoId: string): T | null {
  const at = positionOf(items, videoId);
  return at > 0 && at < items.length ? items[at] : null;
}

/** "12 videos", "1 video", "No videos". */
export function videoCount(n: number): string {
  if (n <= 0) return "No videos";
  return `${n.toLocaleString("en-US")} video${n === 1 ? "" : "s"}`;
}

/** "1 unavailable video is hidden", or null. */
export function hiddenText(n: number): string | null {
  if (n <= 0) return null;
  return n === 1 ? "1 unavailable video is hidden" : `${n.toLocaleString("en-US")} unavailable videos are hidden`;
}

/** "Added to Watch later", "Removed from Mix". */
export function savedToast(title: string, saved: boolean): string {
  return saved ? `Added to ${title}` : `Removed from ${title}`;
}

/** The functions' errors in words. */
export function playlistErrorText(code: string): string {
  switch (code) {
    case "not_signed_in":
      return "Sign in to save videos to playlists.";
    case "bad_title":
      return `Give the playlist a name of up to ${PLAYLIST_TITLE_MAX} characters.`;
    case "bad_description":
      return `The description can be up to ${PLAYLIST_DESCRIPTION_MAX.toLocaleString("en-US")} characters.`;
    case "bad_visibility":
      return "Pick public, unlisted or private.";
    case "too_many_playlists":
      return "You have 500 playlists, the most there can be. Delete one to make another.";
    case "too_many_videos":
      return "This playlist has 5,000 videos, the most it can hold.";
    case "video_not_found":
      return "This video can't be saved: it's private or gone.";
    case "watch_later":
      return "Watch later can't be renamed, shared or deleted.";
    case "blocked_words":
      return "That name has words that aren't allowed here.";
    case "not_found":
      return "This playlist doesn't exist, or it isn't yours.";
    case "off":
      return "Playlists are switched off right now.";
    case "not_set_up":
      return "Playlists aren't set up yet: run 043_playlists.sql.";
    default:
      return "Something went wrong. Try again.";
  }
}

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const vis = (v: unknown): PlaylistVisibility => (isPlaylistVisibility(v) ? v : "private");

function firstThumb(r: Record<string, unknown>, publicBase: string | null): string | null {
  if (typeof r.first_video_id !== "string") return null;
  return cardMedia(
    {
      id: r.first_video_id,
      thumbnailUrl: typeof r.first_thumbnail_url === "string" ? r.first_thumbnail_url : null,
      hlsKey: typeof r.first_hls_key === "string" ? r.first_hls_key : null,
      spriteKey: null,
    },
    publicBase,
  ).thumbnail;
}

/** A my_playlists() row. */
export function summaryFrom(r: Record<string, unknown>, publicBase: string | null): PlaylistSummary {
  return {
    id: String(r.id),
    kind: r.kind === "watch_later" ? "watch_later" : "playlist",
    title: String(r.title ?? ""),
    visibility: vis(r.visibility),
    count: num(r.item_count),
    hasVideo: r.has_video === true,
    updatedAt: String(r.updated_at ?? ""),
    firstVideoId: typeof r.first_video_id === "string" ? r.first_video_id : null,
    thumbnail: firstThumb(r, publicBase),
  };
}

/** A playlist_header() row. */
export function headerFrom(r: Record<string, unknown>, publicBase: string | null): PlaylistHeader {
  return {
    id: String(r.id),
    kind: r.kind === "watch_later" ? "watch_later" : "playlist",
    title: String(r.title ?? ""),
    description: String(r.description ?? ""),
    visibility: vis(r.visibility),
    updatedAt: String(r.updated_at ?? ""),
    isOwner: r.is_owner === true,
    owner: {
      name: String(r.owner_name ?? ""),
      handle: typeof r.owner_handle === "string" ? r.owner_handle : null,
      avatarUrl: typeof r.owner_avatar_url === "string" ? r.owner_avatar_url : null,
    },
    count: num(r.item_count),
    hidden: num(r.hidden_count),
    firstVideoId: typeof r.first_video_id === "string" ? r.first_video_id : null,
    thumbnail: firstThumb(r, publicBase),
  };
}

/** A playlist_videos() row. */
export function itemFrom(r: Record<string, unknown>, publicBase: string | null): PlaylistItem {
  return { ...rowToCard(r as unknown as FeedRow, publicBase), position: num(r.position) };
}

/**
 * The list after moving `videoId` right before `beforeId` (to the end when
 * null), the same way move_playlist_video() does, so the page can show it at once.
 */
export function moveIn<T extends { id: string }>(items: readonly T[], videoId: string, beforeId: string | null): T[] {
  const moving = items.find((v) => v.id === videoId);
  if (!moving || videoId === beforeId) return [...items];
  const rest = items.filter((v) => v.id !== videoId);
  const at = beforeId === null ? -1 : rest.findIndex((v) => v.id === beforeId);
  if (at < 0) return [...rest, moving];
  return [...rest.slice(0, at), moving, ...rest.slice(at)];
}
