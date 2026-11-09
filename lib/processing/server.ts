import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getCurrentUser } from "@/lib/auth";
import { flagOn } from "@/lib/flags";
import { createClient } from "@/lib/supabase/server";
import type { StatusContext, StatusVideoRow } from "./handler";
import { signedThumbnailUrl } from "./media";
import type { FailedJob } from "./retry";
import { readJob, type JobInfo } from "./status";

/** The real Supabase, session and flag for /api/videos/[id]/status. */
export async function statusContext(): Promise<StatusContext> {
  const supabase = await createClient();
  return {
    db: supabase
      ? {
          async video(id) {
            const { data } = await supabase
              .from("videos")
              .select("id, owner_id, status, thumbnail_url, error")
              .eq("id", id)
              .maybeSingle();
            return (data as StatusVideoRow | null) ?? null;
          },
          async job(videoId) {
            const { data } = await supabase
              .from("encode_jobs")
              .select("status, progress, attempts")
              .eq("video_id", videoId)
              .maybeSingle();
            return data;
          },
        }
      : null,
    userId: async () => (await getCurrentUser())?.id ?? null,
    flagOn: (userId) => flagOn("processing", userId),
    thumbnail: signedThumbnailUrl,
  };
}

/**
 * The encode jobs of these videos, by video id. Row level security only shows
 * jobs of the person's own videos. Empty when migration 006 is not applied.
 */
export async function jobsFor(supabase: SupabaseClient, videoIds: string[]): Promise<Map<string, JobInfo>> {
  const out = new Map<string, JobInfo>();
  if (videoIds.length === 0) return out;
  const { data, error } = await supabase
    .from("encode_jobs")
    .select("video_id, status, progress, attempts")
    .in("video_id", videoIds);
  if (error || !data) return out;
  for (const row of data as { video_id: string }[]) {
    const job = readJob(row);
    if (job) out.set(row.video_id, job);
  }
  return out;
}

/**
 * The failed encode jobs of these videos (the last error), by video id, for
 * the Retry button. Row level security only shows the person's own jobs.
 */
export async function failedJobsFor(supabase: SupabaseClient, videoIds: string[]): Promise<Map<string, FailedJob>> {
  const out = new Map<string, FailedJob>();
  if (videoIds.length === 0) return out;
  const { data, error } = await supabase.from("encode_jobs").select("video_id, status, error").in("video_id", videoIds);
  if (error || !data) return out;
  for (const row of data as { video_id: string; status: string; error: string | null }[]) {
    out.set(row.video_id, { status: String(row.status), error: row.error ?? null });
  }
  return out;
}

/** The codes retry_encode() raises, passed on as they are; anything else is "failed". */
const RETRY_CODES = new Set(["not_signed_in", "studio_off", "not_found", "in_trash", "not_failed", "cannot_retry", "rate_limited", "banned", "suspended"]);

/** Processes the caller's failed video again (retry_encode in 033_retry_failed.sql). */
export async function retryEncode(videoId: string): Promise<{ ok: true } | { error: string }> {
  const supabase = await createClient();
  if (!supabase) return { error: "no_db" };
  if (!(await getCurrentUser())) return { error: "not_signed_in" };
  const { error } = await supabase.rpc("retry_encode", { video_id: videoId });
  if (!error) return { ok: true };
  if (error.code === "PGRST202" || error.code === "42883") return { error: "studio_off" };
  const code = String(error.message ?? "").trim();
  return { error: RETRY_CODES.has(code) ? code : "failed" };
}
