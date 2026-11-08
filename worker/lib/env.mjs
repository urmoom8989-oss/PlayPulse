// The worker's settings, read from the environment (the box's env file).
import { availableParallelism, hostname, tmpdir } from "node:os";
import { CAPTION_MAX_THREADS } from "./limits.mjs";
import { YAPIN_WEBHOOK_HOSTS } from "./yapin.mjs";

/** Always required: the database. */
export const REQUIRED_ENV = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];

/** The bucket, as Cloudflare R2. */
export const R2_ENV = ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"];

/**
 * Or the bucket as any S3 compatible storage (a Railway bucket, MinIO, AWS S3).
 * When S3_ENDPOINT is set these are used instead of the R2 settings.
 * Optional with them: S3_REGION (default "auto") and S3_FORCE_PATH_STYLE
 * ("true" or "false", default true).
 */
export const S3_ENV = ["S3_ENDPOINT", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY", "S3_BUCKET"];

/**
 * Optional:
 *   WORKER_NAME       shown in encode_jobs.worker (default: the host name)
 *   WORK_DIR          where sources are downloaded and encoded (default: the system temp folder)
 *   STATE_DIR         where the busy marker for the update script lives (default: none)
 *   MEDIA_PUBLIC_URL  https base that serves the bucket's hls/ files, for thumbnail_url.
 *                     Without it thumbnail_url stays empty and the app signs a link.
 *   SITE_URL          this sloptube's address, like https://tube.example.com, for the
 *                     links in Yapin' announcements (feature 16). Without it none are posted.
 *
 * Auto-generated captions (lib/captions.mjs), all optional. The encoder image sets
 * the two model paths; without CAPTIONS_MODEL, or with CAPTIONS=off, there are none.
 *   CAPTIONS            "off" turns them off
 *   CAPTIONS_MODEL      the whisper.cpp speech model file (ggml-base.bin)
 *   CAPTIONS_VAD_MODEL  the voice detection model, so music and silence get no words
 *   CAPTIONS_THREADS    CPU threads for speech to text (default: the CPU count, at most 8)
 *   WHISPER_BIN         the whisper.cpp program (default: whisper-cli on the PATH)
 */
export function readConfig(env = process.env) {
  const get = (name) => env[name]?.trim() || "";
  const useS3 = Boolean(get("S3_ENDPOINT"));
  const storageEnv = useS3 ? S3_ENV : R2_ENV;
  const missing = [...REQUIRED_ENV, ...storageEnv].filter((name) => !get(name));
  const publicUrl = get("MEDIA_PUBLIC_URL").replace(/\/+$/, "");
  const siteUrl = get("SITE_URL").replace(/\/+$/, "");
  const pathStyle = get("S3_FORCE_PATH_STYLE").toLowerCase();
  return {
    missing,
    supabaseUrl: get("SUPABASE_URL"),
    serviceRoleKey: get("SUPABASE_SERVICE_ROLE_KEY"),
    r2: useS3
      ? {
          endpoint: get("S3_ENDPOINT").replace(/\/+$/, ""),
          region: get("S3_REGION") || "auto",
          forcePathStyle: pathStyle !== "false" && pathStyle !== "0",
          accessKeyId: get("S3_ACCESS_KEY_ID"),
          secretAccessKey: get("S3_SECRET_ACCESS_KEY"),
        }
      : {
          accountId: get("R2_ACCOUNT_ID"),
          accessKeyId: get("R2_ACCESS_KEY_ID"),
          secretAccessKey: get("R2_SECRET_ACCESS_KEY"),
        },
    bucket: useS3 ? get("S3_BUCKET") : get("R2_BUCKET"),
    workerName: get("WORKER_NAME") || hostname(),
    workDir: get("WORK_DIR") || tmpdir(),
    stateDir: get("STATE_DIR") || null,
    mediaPublicUrl: /^https:\/\//.test(publicUrl) ? publicUrl : null,
    siteUrl: /^https?:\/\/[^/\s]+$/.test(siteUrl) ? siteUrl : null,
    yapinHosts: YAPIN_WEBHOOK_HOSTS,
    captions:
      get("CAPTIONS_MODEL") && !/^(off|false|no|0)$/i.test(get("CAPTIONS"))
        ? {
            bin: get("WHISPER_BIN") || "whisper-cli",
            model: get("CAPTIONS_MODEL"),
            vadModel: get("CAPTIONS_VAD_MODEL") || null,
            threads: captionThreads(get("CAPTIONS_THREADS")),
          }
        : null,
  };
}

/** CAPTIONS_THREADS when it is a sensible whole number, otherwise the CPU count up to CAPTION_MAX_THREADS. */
export function captionThreads(value, cpus = availableParallelism()) {
  const n = Number(value);
  if (value && Number.isInteger(n) && n >= 1 && n <= 64) return n;
  return Math.max(1, Math.min(CAPTION_MAX_THREADS, cpus));
}
