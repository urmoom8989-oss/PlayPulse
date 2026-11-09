import "server-only";
import { connection } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { flagOn } from "@/lib/flags";
import { readSupabaseConfig } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import { thumbnailLink } from "@/lib/studio/server";
import { botErrorCode, orderProblem, readPanel, type BotPanel, type OrderInput } from "./rules";

/** The Bots item in the studio nav: the bots flag, and the caller's channel has bots_on. */
export async function botsPanelOn(): Promise<boolean> {
  await connection();
  if (!readSupabaseConfig()) return false;
  const user = await getCurrentUser();
  if (!user || !(await flagOn("bots", user.id))) return false;
  const supabase = await createClient();
  if (!supabase) return false;
  const { data, error } = await supabase.from("channels").select("bots_on").eq("owner_id", user.id).maybeSingle();
  return !error && (data as { bots_on?: boolean } | null)?.bots_on === true;
}

export type BotPanelState =
  | { kind: "off" | "signed-out" | "no-db" | "not-set-up" }
  | { kind: "ready"; panel: BotPanel; now: number };

/** The studio's Bots page: the channel, its videos and its orders (bot_panel() in 034_bot_panel.sql). */
export async function botPanelState(): Promise<BotPanelState> {
  await connection();
  if (!readSupabaseConfig()) return { kind: "no-db" };
  const user = await getCurrentUser();
  if (!user) return { kind: "signed-out" };
  if (!(await flagOn("bots", user.id))) return { kind: "off" };
  const supabase = await createClient();
  if (!supabase) return { kind: "no-db" };
  const { data, error } = await supabase.rpc("bot_panel");
  if (error) return error.code === "PGRST202" || error.code === "42883" ? { kind: "not-set-up" } : { kind: "off" };
  const panel = readPanel(data);
  if (!panel) return { kind: "not-set-up" };
  await Promise.all(
    panel.videos.map(async (v) => {
      v.thumbnail = await thumbnailLink(v.id, v.thumbnailName, v.thumbnailUrl);
    }),
  );
  return { kind: "ready", panel, now: Date.now() };
}

export type BotAction =
  | ({ action: "order" } & OrderInput)
  | { action: "cancel"; orderId: string }
  | { action: "live"; videoId: string; on: boolean };

/** Places or cancels an order, or switches bots for a broadcast. */
export async function botAction(a: BotAction): Promise<{ ok: true } | { error: string }> {
  if (a.action === "order") {
    const problem = orderProblem(a);
    if (problem) return { error: problem };
  }
  const supabase = await createClient();
  if (!supabase) return { error: "no_db" };
  if (!(await getCurrentUser())) return { error: "not_signed_in" };
  const { error } =
    a.action === "order"
      ? await supabase.rpc("bot_order_add", {
          video_id: a.videoId,
          views: a.views,
          likes: a.likes,
          dislikes: a.dislikes,
          comments: a.comments,
          subscribers: a.subscribers,
          over_minutes: a.overMinutes,
        })
      : a.action === "cancel"
        ? await supabase.rpc("bot_order_cancel", { order_id: a.orderId })
        : await supabase.rpc("bot_live_set", { video_id: a.videoId, on_air: a.on });
  if (!error) return { ok: true };
  if (error.code === "PGRST202" || error.code === "42883") return { error: "bots_off" };
  return { error: botErrorCode(error.message) };
}
