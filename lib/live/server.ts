import "server-only";
import { getCurrentUser } from "@/lib/auth";
import { viewerKey } from "@/lib/engagement/server";
import { flagOn } from "@/lib/flags";
import { createClient } from "@/lib/supabase/server";
import { rowToCard, type FeedCard, type FeedRow } from "@/lib/feed/types";
import { readPublicBase } from "@/lib/watch/media";
import { broadcastState, isBroadcastKind } from "./state";
import { cardBroadcastFromRow, rowToChatMessage, type CardBroadcast, type ChatMessage, type ChatRow } from "./types";

type Db = NonNullable<Awaited<ReturnType<typeof createClient>>>;

/** The error code a database message carries (raise exception 'code'), or "failed". */
function codeOf(error: { message?: string; code?: string }): string {
  if (error.code === "PGRST202" || error.code === "42883") return "not_set_up";
  const m = (error.message ?? "").trim();
  return /^[a-z_]{3,32}$/.test(m) ? m : "failed";
}

async function db(): Promise<Db | null> {
  return createClient();
}

/** Is either broadcast flag on for this person? Chat and reminders need one. */
export async function broadcastsOn(): Promise<boolean> {
  const user = await getCurrentUser();
  const id = user?.id ?? null;
  const [premieres, live] = await Promise.all([flagOn("premieres", id), flagOn("live", id)]);
  return premieres || live;
}

export async function chatSince(videoId: string, afterId: number | null): Promise<ChatMessage[] | { error: string }> {
  const supabase = await db();
  if (!supabase) return { error: "no_db" };
  const { data, error } = await supabase.rpc("live_chat_since", { video_id: videoId, after_id: afterId, lim: 50 });
  if (error) return { error: codeOf(error) };
  return ((Array.isArray(data) ? data : []) as ChatRow[]).map(rowToChatMessage);
}

export async function chatReplay(videoId: string, from: number, to: number): Promise<ChatMessage[] | { error: string }> {
  const supabase = await db();
  if (!supabase) return { error: "no_db" };
  const { data, error } = await supabase.rpc("live_chat_replay", { video_id: videoId, from_s: from, to_s: to });
  if (error) return { error: codeOf(error) };
  return ((Array.isArray(data) ? data : []) as ChatRow[]).map(rowToChatMessage);
}

export async function postChat(videoId: string, body: string): Promise<{ id: number } | { error: string }> {
  const supabase = await db();
  if (!supabase) return { error: "no_db" };
  const { data, error } = await supabase.rpc("live_chat_post", { video_id: videoId, body });
  if (error) return { error: codeOf(error) };
  return { id: Number(data) };
}

export async function deleteChat(id: number): Promise<{ ok: true } | { error: string }> {
  const supabase = await db();
  if (!supabase) return { error: "no_db" };
  const { error } = await supabase.rpc("live_chat_delete", { message_id: id });
  return error ? { error: codeOf(error) } : { ok: true };
}

/** Counts this viewer as watching (route handlers only: may set the 'sv' cookie). Answers how many are. */
export async function presencePing(videoId: string): Promise<{ viewers: number } | { error: string }> {
  const supabase = await db();
  if (!supabase) return { error: "no_db" };
  const user = await getCurrentUser();
  const viewer = user ? null : await viewerKey();
  const { data, error } = await supabase.rpc("live_presence_ping", { video_id: videoId, viewer });
  if (error) return { error: codeOf(error) };
  return { viewers: Number(data) || 0 };
}

export async function setReminder(videoId: string, on: boolean): Promise<{ reminded: boolean } | { error: string }> {
  const supabase = await db();
  if (!supabase) return { error: "no_db" };
  const { data, error } = await supabase.rpc("set_broadcast_reminder", { video_id: videoId, on });
  if (error) return { error: codeOf(error) };
  return { reminded: data === true };
}

export type BroadcastOptions = { canGoLive: boolean; premieres: boolean; live: boolean };

/** What the studio may offer this channel: Premiere, and Go live for channels allowed to. */
export async function broadcastOptions(): Promise<BroadcastOptions | null> {
  const supabase = await db();
  if (!supabase) return null;
  const { data, error } = await supabase.rpc("my_broadcast_options");
  const row = (!error && Array.isArray(data) ? data[0] : null) as { can_go_live: boolean; premieres: boolean; live: boolean } | null;
  if (!row) return null;
  return { canGoLive: row.can_go_live === true, premieres: row.premieres === true, live: row.live === true };
}

export async function scheduleBroadcast(
  videoId: string,
  kind: "premiere" | "live",
  at: string | null,
): Promise<{ kind: string; at: string; visibility: string } | { error: string }> {
  const supabase = await db();
  if (!supabase) return { error: "no_db" };
  const { data, error } = await supabase.rpc("schedule_broadcast", { video_id: videoId, kind, at });
  if (error) return { error: codeOf(error) };
  const row = (Array.isArray(data) ? data[0] : data) as { broadcast_kind: string; broadcast_at: string; visibility: string } | undefined;
  if (!row) return { error: "failed" };
  return { kind: row.broadcast_kind, at: row.broadcast_at, visibility: row.visibility };
}

export async function cancelBroadcast(videoId: string): Promise<{ ok: true } | { error: string }> {
  const supabase = await db();
  if (!supabase) return { error: "no_db" };
  const { error } = await supabase.rpc("cancel_broadcast", { video_id: videoId });
  return error ? { error: codeOf(error) } : { ok: true };
}

/** Badges for cards: upcoming, live or ended broadcasts among these videos. Empty before 028. */
export async function broadcastInfo(ids: string[]): Promise<Map<string, CardBroadcast>> {
  const out = new Map<string, CardBroadcast>();
  if (ids.length === 0) return out;
  const supabase = await db();
  if (!supabase) return out;
  const { data, error } = await supabase.rpc("broadcast_info", { ids: ids.slice(0, 100) });
  if (error || !Array.isArray(data)) return out;
  for (const row of data as { id: string; kind: string; at: string; state: string; viewers: number }[]) {
    const b = cardBroadcastFromRow(row);
    if (b) out.set(row.id, b);
  }
  return out;
}

/** Adds the broadcast badges to cards, when the premieres or live flag is on (one database call). */
export async function withBroadcasts<T extends { id: string; broadcast?: CardBroadcast | null }>(cards: T[]): Promise<T[]> {
  if (cards.length === 0 || !(await broadcastsOn())) return cards;
  const info = await broadcastInfo(cards.map((c) => c.id));
  if (info.size === 0) return cards;
  return cards.map((c) => (info.has(c.id) ? { ...c, broadcast: info.get(c.id) } : c));
}

/**
 * Broadcasts that started in the last day and that the person set a reminder
 * for, as cards for the bell in the top bar (newest first). Empty without them.
 */
export async function broadcastAlerts(limit = 20): Promise<FeedCard[]> {
  if (!(await broadcastsOn())) return [];
  const supabase = await db();
  if (!supabase) return [];
  const { data, error } = await supabase.rpc("my_broadcast_alerts", { lim: limit });
  if (error || !Array.isArray(data)) return [];
  const publicBase = readPublicBase(process.env.MEDIA_PUBLIC_URL);
  const now = Date.now();
  return (data as (FeedRow & { broadcast_kind: string })[]).map((r) => {
    const card = rowToCard(r, publicBase);
    if (!isBroadcastKind(r.broadcast_kind)) return card;
    const durationS = card.durationS;
    return { ...card, broadcast: { kind: r.broadcast_kind, at: r.published_at, state: broadcastState(r.published_at, durationS, now), viewers: 0 } };
  });
}

export type OwnerBroadcast = {
  options: BroadcastOptions;
  broadcast: { kind: "premiere" | "live"; at: string; state: "upcoming" | "live" | "ended" } | null;
};

/** The studio's Premiere and live panel: what this channel may do, and the video's broadcast. */
export async function ownerBroadcast(videoId: string): Promise<OwnerBroadcast | { error: string }> {
  const supabase = await db();
  if (!supabase) return { error: "no_db" };
  const [options, info] = await Promise.all([broadcastOptions(), supabase.rpc("watch_broadcast", { video_id: videoId })]);
  if (!options) return { error: "not_set_up" };
  const row = (!info.error && Array.isArray(info.data) ? info.data[0] : null) as { kind: string | null; at: string | null; state: string | null } | null;
  const state = row?.state === "upcoming" || row?.state === "live" || row?.state === "ended" ? row.state : null;
  return {
    options,
    broadcast: row && isBroadcastKind(row.kind) && row.at && state ? { kind: row.kind, at: row.at, state } : null,
  };
}
