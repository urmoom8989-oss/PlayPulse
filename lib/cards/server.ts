import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getCurrentUser } from "@/lib/auth";
import { flagOn } from "@/lib/flags";
import { createClient } from "@/lib/supabase/server";
import { readCard, type CardPayload, type CardVideoChoice, type WatchCard } from "./rules";

// Cards (041_cards.sql) on the server.

/** A video's cards for the player and the editor; none before 041 or with the flag off. */
export async function cardsFor(supabase: SupabaseClient, videoId: string, userId: string | null): Promise<WatchCard[]> {
  if (!(await flagOn("video_cards", userId))) return [];
  const { data, error } = await supabase.rpc("video_cards_for", { video_id: videoId });
  if (error || !Array.isArray(data)) return [];
  return data.map((r) => readCard(r as Record<string, unknown>)).filter((c): c is WatchCard => c !== null);
}

const CODES = ["not_signed_in", "not_owner", "too_many", "bad_card", "bad_message", "bad_time", "bad_url", "video_not_found", "channel_not_found"];

/** Replaces the signed in owner's cards on a video (set_video_cards). Answers how many it saved. */
export async function saveCards(videoId: string, cards: CardPayload[]): Promise<{ saved: number } | { error: string }> {
  const supabase = await createClient();
  if (!supabase) return { error: "no_db" };
  const user = await getCurrentUser();
  if (!user) return { error: "not_signed_in" };
  if (!(await flagOn("video_cards", user.id))) return { error: "off" };
  const { data, error } = await supabase.rpc("set_video_cards", { video_id: videoId, cards });
  if (error) {
    if (error.code === "PGRST202" || error.code === "42883") return { error: "not_set_up" };
    const code = CODES.find((c) => error.message?.includes(c));
    return { error: code ?? "failed" };
  }
  return { saved: Number(data) || 0 };
}

/** The cards of one of the signed in account's videos, for the studio editor; null with the flag off. */
export async function cardsForEditor(videoId: string): Promise<WatchCard[] | null> {
  const supabase = await createClient();
  if (!supabase) return null;
  const user = await getCurrentUser();
  if (!user || !(await flagOn("video_cards", user.id))) return null;
  return cardsFor(supabase, videoId, user.id);
}

/** The signed in account's public and unlisted videos that are ready, newest first: the video card's list. */
export async function myCardVideos(): Promise<{ videos: CardVideoChoice[] } | { error: string }> {
  const supabase = await createClient();
  if (!supabase) return { error: "no_db" };
  const user = await getCurrentUser();
  if (!user) return { error: "not_signed_in" };
  if (!(await flagOn("video_cards", user.id))) return { error: "off" };
  const { data, error } = await supabase
    .from("videos")
    .select("id, title, duration_s, visibility")
    .eq("owner_id", user.id)
    .eq("status", "ready")
    .in("visibility", ["public", "unlisted"])
    .is("deleted_at", null)
    .is("removed_at", null)
    .order("created_at", { ascending: false })
    .limit(300);
  if (error) return { error: "failed" };
  return {
    videos: ((data ?? []) as { id: string; title: string; duration_s: number | null; visibility: "public" | "unlisted" }[]).map((v) => ({
      id: v.id,
      title: v.title,
      durationS: v.duration_s === null ? null : Number(v.duration_s),
      visibility: v.visibility,
    })),
  };
}
