import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getCurrentUser } from "@/lib/auth";
import { flagOn } from "@/lib/flags";
import { createClient } from "@/lib/supabase/server";
import { readPublicBase } from "@/lib/watch/media";
import {
  PLAYLIST_SHOWN,
  headerFrom,
  itemFrom,
  summaryFrom,
  type PlaylistHeader,
  type PlaylistItem,
  type PlaylistSummary,
  type PlaylistVisibility,
} from "./rules";

// Playlists (043_playlists.sql) on the server.

/** MEDIA_PUBLIC_URL, read at request time (lib/watch/server.ts imports this file, so not from there). */
const mediaPublicBase = () => readPublicBase(process.env.MEDIA_PUBLIC_URL);

const CODES = [
  "not_signed_in",
  "not_found",
  "bad_title",
  "bad_description",
  "bad_visibility",
  "too_many_playlists",
  "too_many_videos",
  "video_not_found",
  "watch_later",
  "blocked_words",
  "banned",
];

type Fail = { error: string };

function failure(error: { code?: string; message?: string }): Fail {
  if (error.code === "PGRST202" || error.code === "42883") return { error: "not_set_up" };
  return { error: CODES.find((c) => error.message?.includes(c)) ?? "failed" };
}

/** The database, the signed in person, and the flag; or why not. */
async function gate(): Promise<{ supabase: SupabaseClient; userId: string } | Fail> {
  const supabase = await createClient();
  if (!supabase) return { error: "no_db" };
  const user = await getCurrentUser();
  if (!user) return { error: "not_signed_in" };
  if (!(await flagOn("playlists", user.id))) return { error: "off" };
  return { supabase, userId: user.id };
}

/** The signed in person's playlists, Watch later first, with whether `videoId` is in each. */
export async function myPlaylists(videoId: string | null = null): Promise<{ playlists: PlaylistSummary[] } | Fail> {
  const g = await gate();
  if ("error" in g) return g;
  const { data, error } = await g.supabase.rpc("my_playlists", { video_id: videoId });
  if (error) return failure(error);
  const base = mediaPublicBase();
  return { playlists: (Array.isArray(data) ? data : []).map((r) => summaryFrom(r as Record<string, unknown>, base)) };
}

export async function createPlaylist(title: string, visibility: PlaylistVisibility, videoId: string | null): Promise<{ id: string } | Fail> {
  const g = await gate();
  if ("error" in g) return g;
  const { data, error } = await g.supabase.rpc("create_playlist", { title, visibility, video_id: videoId });
  if (error) return failure(error);
  return { id: String(data) };
}

export async function updatePlaylist(
  playlistId: string,
  patch: { title?: string | null; description?: string | null; visibility?: PlaylistVisibility | null },
): Promise<{ ok: true } | Fail> {
  const g = await gate();
  if ("error" in g) return g;
  const { error } = await g.supabase.rpc("update_playlist", {
    playlist_id: playlistId,
    title: patch.title ?? null,
    description: patch.description ?? null,
    visibility: patch.visibility ?? null,
  });
  if (error) return failure(error);
  return { ok: true };
}

export async function deletePlaylist(playlistId: string): Promise<{ ok: true } | Fail> {
  const g = await gate();
  if ("error" in g) return g;
  const { error } = await g.supabase.rpc("delete_playlist", { playlist_id: playlistId });
  if (error) return failure(error);
  return { ok: true };
}

/** Adds (at the end) or removes a video; answers the playlist's count. */
export async function setPlaylistVideo(playlistId: string, videoId: string, saved: boolean): Promise<{ count: number } | Fail> {
  const g = await gate();
  if ("error" in g) return g;
  const { data, error } = await g.supabase.rpc("set_playlist_video", { playlist_id: playlistId, video_id: videoId, saved });
  if (error) return failure(error);
  return { count: Number(data) || 0 };
}

/** Moves a video right before `beforeId`, or to the end when it is null. */
export async function movePlaylistVideo(playlistId: string, videoId: string, beforeId: string | null): Promise<{ ok: true } | Fail> {
  const g = await gate();
  if ("error" in g) return g;
  const { error } = await g.supabase.rpc("move_playlist_video", { playlist_id: playlistId, video_id: videoId, before_id: beforeId });
  if (error) return failure(error);
  return { ok: true };
}

/**
 * A playlist and its first videos, for anyone who may see it; null when it
 * can't be seen, "not-set-up" before 043.
 */
async function readPlaylist(
  supabase: SupabaseClient,
  listId: string,
): Promise<{ header: PlaylistHeader; items: PlaylistItem[] } | "not-set-up" | null> {
  const [head, videos] = await Promise.all([
    supabase.rpc("playlist_header", { playlist_id: listId }),
    supabase.rpc("playlist_videos", { playlist_id: listId, lim: PLAYLIST_SHOWN, off: 0 }),
  ]);
  if (head.error && (head.error.code === "PGRST202" || head.error.code === "42883")) return "not-set-up";
  const row = !head.error && Array.isArray(head.data) ? (head.data[0] as Record<string, unknown> | undefined) : undefined;
  if (!row) return null;
  const base = mediaPublicBase();
  const items = !videos.error && Array.isArray(videos.data) ? videos.data.map((r) => itemFrom(r as Record<string, unknown>, base)) : [];
  return { header: headerFrom(row, base), items };
}

export type PlaylistPageState =
  | { kind: "off" | "no-db" | "not-set-up" | "missing" }
  | { kind: "ready"; header: PlaylistHeader; items: PlaylistItem[] };

/** /playlist?list=<id>. */
export async function playlistPage(listId: string | null): Promise<PlaylistPageState> {
  const supabase = await createClient();
  if (!supabase) return { kind: "no-db" };
  const user = await getCurrentUser();
  if (!(await flagOn("playlists", user?.id ?? null))) return { kind: "off" };
  if (!listId || !/^[0-9a-f-]{36}$/i.test(listId)) return { kind: "missing" };
  const list = await readPlaylist(supabase, listId.toLowerCase());
  if (list === "not-set-up") return { kind: "not-set-up" };
  return list ? { kind: "ready", ...list } : { kind: "missing" };
}

/** The panel next to the player for /watch?v=...&list=<id>; null without one. */
export async function watchPanel(listId: string | null): Promise<{ header: PlaylistHeader; items: PlaylistItem[] } | null> {
  if (!listId || !/^[0-9a-f-]{36}$/i.test(listId)) return null;
  const supabase = await createClient();
  if (!supabase) return null;
  const user = await getCurrentUser();
  if (!(await flagOn("playlists", user?.id ?? null))) return null;
  const list = await readPlaylist(supabase, listId.toLowerCase());
  return list === "not-set-up" ? null : list;
}
