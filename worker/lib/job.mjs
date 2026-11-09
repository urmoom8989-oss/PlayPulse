// One encode job, from the claimed row to encode_done (or encode_failed),
// then the auto-generated captions of the ready video.
// Every outside effect comes in through `deps`, so the tests run this with a
// fake database, fake R2 and a fake ffmpeg.
import { mkdir, mkdtemp, readFile, rm, statfs, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { addCaptions } from "./captions.mjs";
import {
  HD_MASTER_PLAYLIST,
  MASTER_PLAYLIST,
  PROGRESS_STEPS,
  SPLIT_STEPS,
  SPRITE_IMAGE,
  SPRITE_VTT,
  buildEncodeArgs,
  buildSpriteArgs,
  buildThumbnailArgs,
  createProgressParser,
  encodePercent,
  mergeMasters,
  renditionPlaylist,
  thumbnailName,
} from "./ffmpeg.mjs";
import { pickRenditions } from "./ladder.mjs";
import { DISK_MARGIN_BYTES, DISK_SOURCE_FACTOR, HD_FROM, JOB_TIMEOUT_MS, PROGRESS_EVERY_MS, THUMBNAIL_AT, X264_HD_PRESET, jobTimeoutMs } from "./limits.mjs";
import { human, limitText, seconds } from "./log.mjs";
import { buildProbeArgs, parseProbe } from "./probe.mjs";
import { run as realRun } from "./run.mjs";
import { buildVtt, spritePlan } from "./sprite.mjs";
import { hlsPrefix } from "./storage.mjs";

/** A failure with a plain reason. retry = false when trying again cannot help. */
export class JobError extends Error {
  constructor(message, { retry = true } = {}) {
    super(message);
    this.retry = retry;
  }
}

/** Free bytes on the disk that holds path. */
export async function freeBytes(path) {
  const s = await statfs(path);
  return Number(s.bavail) * Number(s.bsize);
}

/** Bytes needed on disk before the download starts. */
export function diskNeeded(sourceBytes) {
  return Math.ceil(sourceBytes * DISK_SOURCE_FACTOR) + DISK_MARGIN_BYTES;
}

/** The source file name in the temp folder: source.<ext> from the R2 key. */
function sourceName(key) {
  const ext = /\.([a-z0-9]{2,4})$/i.exec(key)?.[1] ?? "bin";
  return `source.${ext.toLowerCase()}`;
}

/** What ends up in videos.renditions: one entry per rung, smallest first. */
export function renditionsJson(renditions) {
  return renditions.map((r) => ({
    name: r.name,
    width: r.width,
    height: r.height,
    video_kbps: r.videoKbps,
    audio_kbps: r.audioKbps,
    playlist: renditionPlaylist(r),
  }));
}

/**
 * Runs one job. Never throws: failures go to encode_failed.
 * @returns {Promise<"done" | "handed" | "queued" | "failed" | "lost">} ("handed": the low quality is out and the HD part is back in the queue, 039)
 */
export async function processJob(job, deps) {
  const {
    db,
    storage,
    log,
    config,
    run = realRun,
    diskFree = freeBytes,
    // A fixed limit for the tests; without it the limit follows the video's length.
    timeoutMs = null,
    progressEveryMs = PROGRESS_EVERY_MS,
    now = () => Date.now(),
  } = deps;
  const ids = { job: job.jobId.slice(0, 8), video: job.videoId.slice(0, 8) };
  const started = now();
  const controller = new AbortController();
  const { signal } = controller;
  let limit = timeoutMs ?? JOB_TIMEOUT_MS;
  const tooLong = () => controller.abort(new JobError(`took longer than ${limitText(limit)}`, { retry: false }));
  let timer = setTimeout(tooLong, limit);
  // A shutdown (docker stop) aborts the job; the next worker tries it again.
  const onStop = () => controller.abort(new JobError("the worker was stopped", { retry: true }));
  deps.stopSignal?.addEventListener("abort", onStop, { once: true });

  let lastSent = -1;
  let lastAt = 0;
  let lost = false;
  const progress = async (pct, force = false) => {
    const p = Math.max(0, Math.min(100, Math.floor(pct)));
    if (p <= lastSent) return;
    if (!force && now() - lastAt < progressEveryMs) return;
    lastSent = p;
    lastAt = now();
    try {
      const running = await db.progress(job.jobId, p);
      if (!running) {
        lost = true;
        controller.abort(new JobError("the job was taken back by the database"));
      }
    } catch (err) {
      log("progress", ids, `could not save progress: ${err.message}`);
    }
  };

  let dir = null;
  try {
    log("claim", { ...ids, attempt: job.attempt, worker: config.workerName }, `${job.sourceKey}${job.hdOnly ? " (HD only, the low quality is out)" : ""}`);

    // 1. Trust nothing about the upload until R2 says the file is all there.
    if (!job.sourceKey || !(job.sourceBytes > 0)) throw new JobError("the video has no source file", { retry: false });
    const size = await storage.headSize(job.sourceKey, signal);
    if (size === null) throw new JobError("the source file is not in storage", { retry: false });
    if (size !== job.sourceBytes) {
      throw new JobError(`source size ${size} does not match the upload (${job.sourceBytes})`, { retry: false });
    }
    log("head", ids, `source is ${human(size)}, size matches`);

    // 2. Room on disk for the source and everything made from it.
    await mkdir(config.workDir, { recursive: true });
    const free = await diskFree(config.workDir);
    const need = diskNeeded(size);
    if (free < need) throw new JobError(`not enough disk: ${human(free)} free, ${human(need)} needed`);
    log("disk", ids, `${human(free)} free, ${human(need)} needed`);

    dir = await mkdtemp(join(config.workDir, "job-"));
    const out = join(dir, "out");
    await mkdir(out);
    // The sprite's frames, outside `out` so they are never uploaded.
    const spriteFrames = join(dir, "sprite", "%03d.png");
    await mkdir(join(dir, "sprite"));
    const input = join(dir, sourceName(job.sourceKey));

    // 3. Download.
    let t = now();
    // The bar moves while the file comes in (the first 10%), so a slow download does not look stuck.
    // In pieces, 4 at a time, each fetched again if its connection drops. The
    // HD part of a video that plays already keeps its bar where it was.
    const onBytes = job.hdOnly ? undefined : (got) => void progress((PROGRESS_STEPS.downloaded * got) / size);
    await storage.download(job.sourceKey, input, signal, onBytes, { size });
    log("download", ids, `${human(size)} in ${seconds(now() - t)}`);
    if (!job.hdOnly) await progress(PROGRESS_STEPS.downloaded, true);

    // 4. Probe.
    let probe;
    try {
      probe = parseProbe(await run("ffprobe", buildProbeArgs(input), { signal }));
    } catch (err) {
      if (signal.aborted) throw err;
      throw new JobError(`this file could not be read as a video (${err.message})`, { retry: false });
    }
    const renditions = pickRenditions(probe);
    const sprite = spritePlan(probe.durationS);
    // Now that the length is known, a long video gets a longer limit.
    if (timeoutMs === null) {
      limit = jobTimeoutMs(probe.durationS);
      clearTimeout(timer);
      timer = setTimeout(tooLong, Math.max(0, limit - (now() - started)));
    }
    log(
      "probe",
      { ...ids, duration: probe.durationS.toFixed(1), size: `${probe.width}x${probe.height}`, audio: probe.hasAudio },
      `renditions ${renditions.map((r) => `${r.name}(${r.width}x${r.height})`).join(" ")}, time limit ${limitText(limit)}`,
    );

    // Low quality first (038): the renditions below 720p and the sprite in a
    // quick first run, so the video plays within minutes; 720p and up in a
    // second run, added to the master playlist when they are done. A source
    // with nothing to split (all low, or all HD), or a database without 038,
    // gets one run as before.
    const low = renditions.filter((r) => Math.min(r.width, r.height) < HD_FROM);
    const high = renditions.filter((r) => Math.min(r.width, r.height) >= HD_FROM);
    const split = Boolean(job.sdFirst) && low.length > 0 && high.length > 0;
    // A retry of the HD part only (the low renditions are out already). Should
    // the ladder not split any more, everything is made again in one run.
    const hdOnly = split && job.hdOnly === true;
    const steps = split ? SPLIT_STEPS : PROGRESS_STEPS;
    const prefix = hlsPrefix(job.videoId);
    const details = (list) => ({
      durationS: Math.round(probe.durationS * 1000) / 1000,
      width: list[list.length - 1].width,
      height: list[list.length - 1].height,
      hlsKey: `${prefix}/${MASTER_PLAYLIST}`,
      thumbnailUrl: config.mediaPublicUrl ? `${config.mediaPublicUrl}/${prefix}/${thumbnailName(0)}` : null,
      previewSpriteKey: `${prefix}/${SPRITE_VTT}`,
      renditions: renditionsJson(list),
    });
    const encode = async (list, from, to, extra = {}) => {
      const pending = [];
      const parse = createProgressParser((sec) => pending.push(progress(encodePercent(sec, probe.durationS, from, to))));
      await run("ffmpeg", buildEncodeArgs({ input, renditions: list, hasAudio: probe.hasAudio, ...extra }), {
        cwd: out,
        signal,
        onStdout: parse,
      });
      await Promise.all(pending);
    };
    const upload = (folder, keyPrefix, from, to) =>
      storage.uploadDir(folder, keyPrefix, {
        signal,
        onFile: (n, total) => void progress(from + ((to - from) * n) / total),
        onRound: (round, err, left) =>
          log("upload", ids, `storage still busy (${err.message}), ${left} files left, trying again in a minute (round ${round + 1})`),
      });

    if (!hdOnly) {
      // 5. Encode: one ffmpeg run for the low ladder (or the whole one) and the sprite.
      const first = split ? low : renditions;
      t = now();
      await progress(steps.encodeStart, true);
      await encode(first, steps.encodeStart, steps.encodeEnd, { sprite, spriteFrames });
      log("encode", ids, `${first.length} renditions in ${seconds(now() - t)}${split ? " (low quality first)" : ""}`);
      await progress(steps.encodeEnd, true);

      // 6. Thumbnails at 10%, 50% and 90%, the sprite tiled from its frames, and its WebVTT.
      t = now();
      await run("ffmpeg", buildSpriteArgs({ frames: spriteFrames, plan: sprite, output: join(out, SPRITE_IMAGE) }), { signal });
      for (const [i, share] of THUMBNAIL_AT.entries()) {
        const at = Math.min(probe.durationS * share, Math.max(0, probe.durationS - 0.1));
        await run("ffmpeg", buildThumbnailArgs({ input, atSeconds: at, output: join(out, thumbnailName(i)) }), { signal });
      }
      await writeFile(join(out, SPRITE_VTT), buildVtt(sprite, probe.durationS, SPRITE_IMAGE));
      log("thumbnails", ids, `${THUMBNAIL_AT.length} thumbnails and a ${sprite.count} frame sprite in ${seconds(now() - t)}`);
      await progress(steps.thumbnails, true);

      // 7. Upload everything under hls/<video>/.
      t = now();
      const sent = await upload(out, prefix, steps.thumbnails, steps.uploadEnd);
      log("upload", ids, `${sent.files} files, ${human(sent.bytes)} in ${seconds(now() - t)}`);

      // 8. The video plays: at low quality while HD is made, or done. With
      // smart order (039) the HD part goes back to the queue for the HD lane,
      // so the next upload's low quality comes first.
      if (split && job.handoff) {
        await db.sdHandoff(job.jobId, details(low));
        log("sd", ids, `${low.map((r) => r.name).join(", ")} playable in ${seconds(now() - started)}, HD queued`);
        return "handed";
      }
      if (split) {
        await db.sdReady(job.jobId, details(low));
        log("sd", ids, `${low.map((r) => r.name).join(", ")} playable in ${seconds(now() - started)}, HD next`);
      } else {
        await db.done(job.jobId, details(renditions));
        log("done", ids, `ready in ${seconds(now() - started)}`);
      }
    }

    if (split) {
      // 8b. HD: the renditions from 720p up, their own master playlist (not uploaded).
      t = now();
      await progress(steps.hdStart, true);
      await encode(high, steps.hdStart, steps.hdEnd, { masterName: HD_MASTER_PLAYLIST, preset: X264_HD_PRESET });
      log("encode", ids, `${high.length} HD renditions in ${seconds(now() - t)}`);
      t = now();
      let files = 0;
      let bytes = 0;
      const span = (steps.hdUploadEnd - steps.hdEnd) / high.length;
      for (const [i, r] of high.entries()) {
        const sent = await upload(join(out, r.name), `${prefix}/${r.name}`, steps.hdEnd + span * i, steps.hdEnd + span * (i + 1));
        files += sent.files;
        bytes += sent.bytes;
      }
      // The master last, so it never names a file that is not there yet.
      const lowMaster = hdOnly
        ? await storage.getText(`${prefix}/${MASTER_PLAYLIST}`)
        : await readFile(join(out, MASTER_PLAYLIST), "utf8");
      if (!lowMaster) throw new JobError("the low quality master playlist is gone from storage", { retry: false });
      await writeFile(join(out, MASTER_PLAYLIST), mergeMasters(lowMaster, await readFile(join(out, HD_MASTER_PLAYLIST), "utf8")));
      await storage.upload(`${prefix}/${MASTER_PLAYLIST}`, join(out, MASTER_PLAYLIST), signal);
      log("upload", ids, `${files} HD files, ${human(bytes)} in ${seconds(now() - t)}`);
      await db.done(job.jobId, details(renditions));
      log("done", ids, `HD ready in ${seconds(now() - started)}`);
    }

    // 9. Auto-generated captions, now that the video is ready, so nobody waits
    // for them. They have their own time limit and never fail the job.
    clearTimeout(timer);
    await addCaptions(
      { input, dir, out, durationS: probe.durationS, hasAudio: probe.hasAudio, prefix, ids },
      { storage, log, config, run, now, stopSignal: deps.stopSignal, captionsTimeoutMs: deps.captionsTimeoutMs },
    );
    return "done";
  } catch (caught) {
    const err = signal.aborted && signal.reason instanceof Error ? signal.reason : caught;
    if (lost) {
      log("lost", ids, "the database took the job back, stopping without reporting");
      return "lost";
    }
    const retry = err instanceof JobError ? err.retry : true;
    const message = err instanceof Error ? err.message : String(err);
    try {
      const result = await db.failed(job.jobId, message, retry);
      log("failed", { ...ids, retry, result }, message);
      return result === "queued" ? "queued" : "failed";
    } catch (reportErr) {
      log("failed", ids, `${message} (and encode_failed did not answer: ${reportErr.message})`);
      return "failed";
    }
  } finally {
    clearTimeout(timer);
    deps.stopSignal?.removeEventListener("abort", onStop);
    if (dir) {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
      log("cleanup", ids, "temp folder removed");
    }
  }
}
