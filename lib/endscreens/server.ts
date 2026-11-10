import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getCurrentUser } from "@/lib/auth";
import { flagOn } from "@/lib/flags";
import { createClient } from "@/lib/supabase/server";
import { readPublicBase } from "@/lib/watch/media";
import { readEndElement, type EndElement, type EndPayload } from "./rules";

// End screens (045_end_screens.sql) on the server.

const mediaPublicBase = () => readPublicBase(process.env.MEDIA_PUBLIC_URL);

/** A video's end screen for the player and the editor; none before 045 or with the flag off. */
export async function endScreenFor(supabase: SupabaseClient, videoId: string, userId: string | null): Promise<EndElement[]> {
  if (!(await flagOn("end_screens", userId))) return [];
  const { data, error } = await supabase.rpc("video_end_screen", { video_id: videoId });
  if (error || !Array.isArray(data)) return [];
  const base = mediaPublicBase();
  return data.map((r) => readEndElement(r as Record<string, unknown>, base)).filter((e): e is EndElement => e !== null);
}

const CODES = ["not_signed_in", "not_owner", "too_many", "bad_element", "bad_place", "bad_time", "two_subscribes", "video_not_found", "channel_not_found"];

/** Replaces the signed in owner's end screen (set_video_end_screen). Answers how many elements it saved. */
export async function saveEndScreen(videoId: string, elements: EndPayload[]): Promise<{ saved: number } | { error: string }> {
  const supabase = await createClient();
  if (!supabase) return { error: "no_db" };
  const user = await getCurrentUser();
  if (!user) return { error: "not_signed_in" };
  if (!(await flagOn("end_screens", user.id))) return { error: "off" };
  const { data, error } = await supabase.rpc("set_video_end_screen", { video_id: videoId, elements });
  if (error) {
    if (error.code === "PGRST202" || error.code === "42883") return { error: "not_set_up" };
    return { error: CODES.find((c) => error.message?.includes(c)) ?? "failed" };
  }
  return { saved: Number(data) || 0 };
}

/** The end screen of one of the signed in account's videos, for the studio editor; null with the flag off. */
export async function endScreenForEditor(videoId: string): Promise<EndElement[] | null> {
  const supabase = await createClient();
  if (!supabase) return null;
  const user = await getCurrentUser();
  if (!user || !(await flagOn("end_screens", user.id))) return null;
  return endScreenFor(supabase, videoId, user.id);
}
