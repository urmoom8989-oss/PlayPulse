import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getCurrentUser } from "@/lib/auth";
import { flagOn } from "@/lib/flags";
import { createClient } from "@/lib/supabase/server";
import { readWatermark, type PlayerWatermark, type Watermark } from "./watermark-rules";

// The channel watermark (044_watermarks.sql) on the server.

/** A channel's watermark; null without one, with the flag off, or before 044. */
async function watermarkOf(supabase: SupabaseClient, channelId: string): Promise<Watermark | null> {
  const { data, error } = await supabase
    .from("channels")
    .select("watermark_url, watermark_show, watermark_start_s")
    .eq("id", channelId)
    .maybeSingle();
  if (error || !data) return null;
  return readWatermark(data as Record<string, unknown>);
}

/** For the studio's Channel customization: whether the editor shows, and the saved watermark. */
export async function studioWatermark(channelId: string): Promise<{ on: boolean; watermark: Watermark | null }> {
  const supabase = await createClient();
  if (!supabase) return { on: false, watermark: null };
  const user = await getCurrentUser();
  if (!(await flagOn("watermark", user?.id ?? null))) return { on: false, watermark: null };
  return { on: true, watermark: await watermarkOf(supabase, channelId) };
}

/** For the player: the watermark of the video's channel, with whose it is. */
export async function playerWatermark(
  supabase: SupabaseClient,
  channel: { id: string; name: string; handle: string },
  userId: string | null,
): Promise<PlayerWatermark | null> {
  if (!(await flagOn("watermark", userId))) return null;
  const w = await watermarkOf(supabase, channel.id);
  return w ? { ...w, channelId: channel.id, channelName: channel.name, channelHandle: channel.handle } : null;
}
