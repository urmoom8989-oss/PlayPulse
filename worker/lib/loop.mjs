// The worker loop: ask for a job, run it, ask again. ENCODE_SLOTS loops run
// side by side (2 by default), so a few videos process at once; each slot
// has its own name in encode_jobs.worker ("<worker>/1", "<worker>/2").
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { drainCleanup } from "./cleanup.mjs";
import { processJob } from "./job.mjs";
import { CLEANUP_EVERY_MS, HEARTBEAT_MS, POLL_MS, YAPIN_EVERY_MS } from "./limits.mjs";
import { drainYapin } from "./yapin.mjs";

/** Resolves after ms, or right away when the signal aborts. */
export function sleep(ms, signal) {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const t = setTimeout(done, ms);
    function done() {
      clearTimeout(t);
      signal?.removeEventListener("abort", done);
      resolve();
    }
    signal?.addEventListener("abort", done, { once: true });
  });
}

/** The jobs this process is running now, for the busy marker. */
const running = new Set();

/**
 * The marker the update script looks at: while it exists the box does not
 * swap the worker for a newer image, so a running encode is not cut off.
 * It lists every job in progress and goes away when the last one ends.
 */
async function markBusy(stateDir, job) {
  running.add(job.jobId);
  if (!stateDir) return;
  await writeFile(join(stateDir, "busy"), `${[...running].join("\n")}\n`).catch(() => {});
}

async function markIdle(stateDir, job) {
  if (job) running.delete(job.jobId);
  else running.clear();
  if (!stateDir) return;
  if (running.size) await writeFile(join(stateDir, "busy"), `${[...running].join("\n")}\n`).catch(() => {});
  else await rm(join(stateDir, "busy"), { force: true }).catch(() => {});
}

/** The name a slot claims jobs under: the worker's own with one slot, "<worker>/n" with more. */
export function slotName(workerName, slot, slots) {
  return slots > 1 ? `${workerName}/${slot}` : workerName;
}

/**
 * One turn of the loop. Returns the job's result, "idle" when there was
 * nothing to do, or "error" when the database could not be asked.
 */
export async function tick(deps) {
  const { db, log, config, heartbeatMs = HEARTBEAT_MS } = deps;
  let job;
  try {
    job = await db.claim(config.workerName);
  } catch (err) {
    log("claim", {}, `could not ask for a job: ${err.message}`);
    return "error";
  }
  if (!job) return "idle";
  await markBusy(config.stateDir, job);
  // Alive every minute, whatever step it is on, so the other slots leave it alone.
  const beat = db.heartbeat ? setInterval(() => void db.heartbeat(job.jobId).catch(() => {}), heartbeatMs) : null;
  try {
    return await processJob(job, deps);
  } finally {
    if (beat) clearInterval(beat);
    await markIdle(config.stateDir, job);
  }
}

/** Removes job folders a crashed run left in the work folder. Returns how many. */
export async function cleanWorkDir(workDir) {
  await mkdir(workDir, { recursive: true });
  const stale = (await readdir(workDir)).filter((name) => name.startsWith("job-"));
  await Promise.all(stale.map((name) => rm(join(workDir, name), { recursive: true, force: true })));
  return stale.length;
}

/**
 * One slot: polls every POLL_MS until the stop signal aborts. Slot 1 also
 * empties the trash and posts Yapin' announcements between its encodes.
 */
async function slotLoop(deps, slot) {
  const { stopSignal, pollMs = POLL_MS, cleanupEveryMs = CLEANUP_EVERY_MS, yapinEveryMs = YAPIN_EVERY_MS, now = Date.now } = deps;
  let errors = 0;
  let lastCleanup = -Infinity;
  let lastYapin = -Infinity;
  // Slots after the first start a moment later, so they do not all ask at once.
  if (slot > 1) await sleep(Math.min(pollMs, 1000) * (slot - 1), stopSignal);
  while (!stopSignal?.aborted) {
    const result = await tick(deps);
    if (slot === 1) {
      // Between encodes, now and then: the R2 folders of purged videos.
      if (result === "idle" && now() - lastCleanup >= cleanupEveryMs) {
        lastCleanup = now();
        await drainCleanup(deps, { signal: stopSignal });
      }
      // Between encodes: Yapin' announcements of videos that just went public.
      if (result === "idle" && deps.config.siteUrl && deps.db.claimYapin && now() - lastYapin >= yapinEveryMs) {
        lastYapin = now();
        await drainYapin(deps, { signal: stopSignal });
      }
    }
    if (result === "idle") errors = 0;
    if (result === "error") errors++;
    // Back off up to a minute while the database is unreachable.
    if (result === "idle" || result === "error") await sleep(Math.min(pollMs * 2 ** Math.min(errors, 4), 60000), stopSignal);
  }
}

/** Runs ENCODE_SLOTS slots until the stop signal aborts. */
export async function runLoop(deps) {
  const { pollMs = POLL_MS, log } = deps;
  const slots = Math.max(1, deps.config.encodeSlots ?? 1);
  const cleaned = await cleanWorkDir(deps.config.workDir);
  await markIdle(deps.config.stateDir);
  // Jobs this worker's slots were running before a restart go back in the queue at once.
  const released = deps.db.release ? await deps.db.release(deps.config.workerName).catch(() => 0) : 0;
  log(
    "start",
    { worker: deps.config.workerName, slots },
    `polling every ${pollMs / 1000}s, ${slots} video${slots === 1 ? "" : "s"} at a time` +
      `${cleaned ? `, removed ${cleaned} old job folders` : ""}${released ? `, gave back ${released} unfinished jobs` : ""}`,
  );
  if (!deps.config.siteUrl) log("yapin", {}, "SITE_URL is not set: Yapin' announcements are not posted");
  await Promise.all(
    Array.from({ length: slots }, (_, i) =>
      slotLoop({ ...deps, config: { ...deps.config, workerName: slotName(deps.config.workerName, i + 1, slots) } }, i + 1),
    ),
  );
  log("stop", { worker: deps.config.workerName }, "stopped");
}
