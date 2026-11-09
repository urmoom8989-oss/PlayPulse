// The Retry button for videos whose processing failed (033_retry_failed.sql,
// the retry_failed flag). No imports on purpose, so Node can load this file
// directly in the tests.

/** retry_encode() allows this many retries a day per video. */
export const RETRIES_PER_DAY = 3;

/** The encode job of a failed video, as the studio reads it from encode_jobs. */
export type FailedJob = { status: string; error: string | null };

/**
 * True when the button can work: the video failed while processing (its job
 * failed). An upload that never finished has no job, and only a new upload helps.
 */
export function canRetry(videoStatus: string, job: FailedJob | null | undefined): boolean {
  return videoStatus === "failed" && job?.status === "failed";
}

/** The encoder's last error in words for the owner: what went wrong, not the raw message. */
export function failureText(reason: string | null | undefined): string {
  const r = String(reason ?? "").trim();
  if (!r) return "Processing failed.";
  if (/reduce your request rate|slowdown|slow down|throttl|too many requests/i.test(r)) {
    return "Storage was too busy while saving the processed video.";
  }
  if (/could not be read as a video/i.test(r)) return "This file couldn't be read as a video.";
  if (/no source file|not in storage|does not match the upload/i.test(r)) return "The uploaded file is missing or incomplete.";
  if (/took longer than/i.test(r)) return "Processing took longer than the time limit.";
  if (/worker (was )?stopped|taken back by the database/i.test(r)) return "The encoder restarted while processing.";
  if (/not enough disk/i.test(r)) return "The encoder ran out of space.";
  return r.length > 120 ? `${r.slice(0, 117).trimEnd()}...` : r;
}

/** What the toast says after the Retry button, or for its error code. */
export function retryMessage(code: string | null): string {
  switch (code) {
    case null:
      return "Processing again. Long videos can take a few hours.";
    case "cannot_retry":
      return "This upload never finished, so there's nothing to process. Upload the file again.";
    case "not_failed":
      return "This video is already being processed.";
    case "rate_limited":
      return `You can retry a video ${RETRIES_PER_DAY} times a day. Try again tomorrow.`;
    case "in_trash":
      return "Restore the video from the trash first.";
    case "not_found":
      return "That video is gone.";
    case "not_signed_in":
      return "Sign in to retry.";
    case "studio_off":
      return "Retrying isn't on yet.";
    case "suspended":
      return "Your channel is suspended.";
    case "banned":
      return "This account has been banned.";
    default:
      return "Couldn't retry. Try again in a moment.";
  }
}
