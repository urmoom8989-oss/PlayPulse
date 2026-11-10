import "server-only";
import { getCurrentUser } from "@/lib/auth";
import { flagOn } from "@/lib/flags";
import { createClient } from "@/lib/supabase/server";
import type { UploadOptions } from "./options-rules";

// set_upload_options() (042_upload_options.sql) for the signed in owner.

const CODES = ["not_signed_in", "not_found", "removed", "in_trash", "bad_visibility", "bad_schedule"];

export async function saveUploadOptions(videoId: string, o: UploadOptions): Promise<{ visibility: string } | { error: string }> {
  const supabase = await createClient();
  if (!supabase) return { error: "no_db" };
  const user = await getCurrentUser();
  if (!user) return { error: "not_signed_in" };
  // Off: the uploader only offers Private and Public, which publish_video() sets.
  if (!(await flagOn("upload_options", user.id))) return { error: "off" };
  const { data, error } = await supabase.rpc("set_upload_options", {
    video_id: videoId,
    visibility: o.visibility,
    publish_at: o.publishAt,
    paid_promotion: o.paidPromotion,
    draft: o.draft,
  });
  if (error) {
    if (error.code === "PGRST202" || error.code === "42883") return { error: "not_set_up" };
    return { error: CODES.find((c) => error.message?.includes(c)) ?? "failed" };
  }
  return { visibility: String(data) };
}

/** Draft, schedule and paid promotion of the caller's own videos; empty before 042. */
export async function uploadOptionsFor(
  supabase: NonNullable<Awaited<ReturnType<typeof createClient>>>,
  ids: string[],
): Promise<Map<string, { draft: boolean; publishAt: string | null; paidPromotion: boolean }>> {
  if (ids.length === 0) return new Map();
  const { data, error } = await supabase.from("videos").select("id, draft, publish_at, paid_promotion").in("id", ids);
  if (error || !data) return new Map();
  return new Map(
    (data as { id: string; draft: boolean | null; publish_at: string | null; paid_promotion: boolean | null }[]).map((r) => [
      String(r.id),
      { draft: r.draft === true, publishAt: r.publish_at, paidPromotion: r.paid_promotion === true },
    ]),
  );
}

/** "Includes paid promotion" for the watch page (video_paid_promotion); false before 042. */
export async function videoPaidPromotion(supabase: NonNullable<Awaited<ReturnType<typeof createClient>>>, videoId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("video_paid_promotion", { video_id: videoId });
  return !error && data === true;
}
