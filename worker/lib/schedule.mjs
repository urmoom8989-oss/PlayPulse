// Scheduled videos (042_upload_options.sql): once a minute, beside the encode
// loop and whatever it is doing, the videos whose time has come go public.
// A video still processing then goes public as soon as it is ready.
import { sleep } from "./loop.mjs";

/** How often the worker asks publish_scheduled(). */
export const SCHEDULE_EVERY_MS = 60 * 1000;

/** Without 042 the worker asks again this often, in case it was run since. */
export const SCHEDULE_MISSING_EVERY_MS = 10 * 60 * 1000;

/**
 * One round: the number of videos that went public, 0 when none, or null when
 * the database does not have publish_scheduled() yet (042 not run).
 */
export async function publishRound(deps) {
  const { db, log } = deps;
  const n = await db.publishScheduled();
  if (n === null) return null;
  if (n > 0) log("schedule", { published: n }, `${n} scheduled video${n === 1 ? "" : "s"} went public`);
  return n;
}

/** Runs rounds until the stop signal aborts. A failed round is logged and tried again next time. */
export async function runScheduler(deps) {
  const { log, stopSignal, everyMs = SCHEDULE_EVERY_MS, missingEveryMs = SCHEDULE_MISSING_EVERY_MS } = deps;
  if (!deps.db.publishScheduled) return;
  let missingSaid = false;
  while (!stopSignal?.aborted) {
    let wait = everyMs;
    try {
      const n = await publishRound(deps);
      if (n === null) {
        wait = missingEveryMs;
        if (!missingSaid) log("schedule", {}, "042_upload_options.sql is not run yet: scheduled videos wait until it is");
        missingSaid = true;
      } else {
        missingSaid = false;
      }
    } catch (err) {
      log("schedule", {}, `round failed: ${err.message}`);
    }
    await sleep(wait, stopSignal);
  }
}
