// Feature 4 on the app side: the status route logic and the studio lines.
import assert from "node:assert/strict";
import { test } from "node:test";
import { videoStatus } from "../lib/processing/handler.ts";
import { defaultThumbnailKey, isActive, isWaiting, processingLine, progressFor, readJob, uploadStatusText } from "../lib/processing/status.ts";

const OWNER = "11111111-2222-3333-4444-555555555555";
const OTHER = "99999999-8888-7777-6666-555555555555";
const VIDEO = "aaaaaaaa-bbbb-cccc-dddd-000000000001";

function ctx({ userId = OWNER, flag = true, db = true, video = {}, job = null, thumb = "https://r2.example.com/signed" } = {}) {
  const row = { id: VIDEO, owner_id: OWNER, status: "processing", thumbnail_url: null, error: null, ...video };
  return {
    db: db ? { video: async (id) => (id === VIDEO ? row : null), job: async () => job } : null,
    userId: async () => userId,
    flagOn: async () => flag,
    thumbnail: async () => thumb,
  };
}

test("status: errors come before any lookup", async () => {
  assert.deepEqual(await videoStatus(VIDEO, ctx({ db: false })), { status: 503, body: { error: "no_db" } });
  assert.deepEqual(await videoStatus(VIDEO, ctx({ userId: null })), { status: 401, body: { error: "not_signed_in" } });
  assert.deepEqual(await videoStatus(VIDEO, ctx({ flag: false })), { status: 403, body: { error: "processing_off" } });
  assert.deepEqual(await videoStatus("not-a-uuid", ctx()), { status: 404, body: { error: "not_found" } });
});

test("status: owner only, anybody else gets the same 404 as a missing video", async () => {
  assert.deepEqual(await videoStatus(VIDEO, ctx({ userId: OTHER })), { status: 404, body: { error: "not_found" } });
  assert.deepEqual(await videoStatus(OTHER, ctx()), { status: 404, body: { error: "not_found" } });
});

test("status: a running job shows its percent", async () => {
  const r = await videoStatus(VIDEO.toUpperCase(), ctx({ job: { status: "running", progress: 42, attempts: 1 } }));
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, {
    id: VIDEO,
    status: "processing",
    progress: 42,
    job: { status: "running", progress: 42, attempts: 1 },
    thumbnailUrl: null,
    error: null,
  });
});

test("status: waiting in line is 0%", async () => {
  const r = await videoStatus(VIDEO, ctx({ video: { status: "uploaded" }, job: { status: "queued", progress: 0, attempts: 0 } }));
  assert.equal(r.body.progress, 0);
  assert.equal(r.body.job.status, "queued");
});

test("status: ready gets 100% and a thumbnail, public url first", async () => {
  const signed = await videoStatus(VIDEO, ctx({ video: { status: "ready" }, job: { status: "done", progress: 100, attempts: 1 } }));
  assert.equal(signed.body.progress, 100);
  assert.equal(signed.body.thumbnailUrl, "https://r2.example.com/signed");
  const pub = await videoStatus(VIDEO, ctx({ video: { status: "ready", thumbnail_url: "https://media.example.com/t.webp" } }));
  assert.equal(pub.body.thumbnailUrl, "https://media.example.com/t.webp");
});

test("status: failed carries the reason, without migration 006 there is no job", async () => {
  const r = await videoStatus(VIDEO, ctx({ video: { status: "failed", error: "this file could not be read as a video" } }));
  assert.equal(r.body.error, "this file could not be read as a video");
  assert.equal(r.body.job, null);
  assert.equal(r.body.progress, null);
});

test("readJob cleans what the database sends", () => {
  assert.deepEqual(readJob({ status: "running", progress: "57", attempts: 2 }), { status: "running", progress: 57, attempts: 2 });
  assert.deepEqual(readJob({ status: "running", progress: 250, attempts: -1 }), { status: "running", progress: 100, attempts: 0 });
  assert.equal(readJob({ status: "exploded" }), null);
  assert.equal(readJob(null), null);
});

test("the studio line under the badge", () => {
  const running = { status: "running", progress: 42, attempts: 1 };
  assert.equal(processingLine({ status: "processing", job: running, progress: 42 }), "Processing, 42%");
  assert.equal(processingLine({ status: "uploaded", job: { status: "queued", progress: 0, attempts: 0 }, progress: 0 }), "Waiting to process");
  assert.equal(
    processingLine({ status: "processing", job: { status: "queued", progress: 0, attempts: 1 }, progress: 0 }),
    "Trying again (attempt 2 of 3)",
  );
  assert.equal(processingLine({ status: "ready", job: running, progress: 100 }), null);
  assert.equal(processingLine({ status: "processing", job: null, progress: null }), null);
});

test("progress, polling and the thumbnail key", () => {
  assert.equal(progressFor("ready", null), 100);
  assert.equal(progressFor("uploading", { status: "queued", progress: 0, attempts: 0 }), null);
  assert.equal(progressFor("processing", { status: "queued", progress: 30, attempts: 1 }), 0);
  assert.equal(isActive("uploaded"), true);
  assert.equal(isActive("processing"), true);
  assert.equal(isActive("ready"), false);
  assert.equal(isActive("failed"), false);
  assert.equal(defaultThumbnailKey(VIDEO.toUpperCase()), `hls/${VIDEO}/thumb-1.webp`);
});

test("037: heartbeats, not run time, decide that a job stopped; people with nothing processing first", async () => {
  const { readFileSync } = await import("node:fs");
  const sql = readFileSync(new URL("../supabase/migrations/037_parallel_encodes.sql", import.meta.url), "utf8");
  assert.match(sql, /add column if not exists heartbeat_at/);
  assert.match(sql, /else j\.heartbeat_at < now\(\) - interval '10 minutes'/);
  assert.match(sql, /when j\.heartbeat_at is null then j\.started_at < now\(\) - public\.encode_stale_after\(\)/);
  assert.match(sql, /order by exists \(/);
  assert.match(sql, /j\.worker like me \|\| '\/%'/);
  for (const fn of ["claim_encode_job(text)", "encode_progress(uuid, int)", "encode_heartbeat(uuid)", "encode_release(text)"]) {
    assert.ok(sql.includes(`grant execute on function public.${fn} to service_role`), fn);
  }
});

test("038: low quality first, the status says HD is still being made", async () => {
  const running = { status: "running", progress: 64, attempts: 1 };
  const hd = await videoStatus(VIDEO, ctx({ video: { status: "ready", hd_pending: true }, job: running }));
  assert.equal(hd.body.status, "ready");
  assert.equal(hd.body.hdPending, true);
  assert.equal(hd.body.progress, 64);
  assert.equal(hd.body.thumbnailUrl, "https://r2.example.com/signed");
  // HD done, or a database before 038: no hdPending at all, 100%.
  for (const video of [{ status: "ready", hd_pending: false }, { status: "ready" }]) {
    const r = await videoStatus(VIDEO, ctx({ video, job: { status: "done", progress: 100, attempts: 1 } }));
    assert.equal("hdPending" in r.body, false);
    assert.equal(r.body.progress, 100);
  }
  // hd_pending on a video that is not ready means nothing.
  const odd = await videoStatus(VIDEO, ctx({ video: { status: "processing", hd_pending: true }, job: running }));
  assert.equal("hdPending" in odd.body, false);

  assert.equal(processingLine({ status: "ready", hdPending: true, job: running, progress: 64 }), "HD processing, 64%");
  assert.equal(processingLine({ status: "ready", hdPending: true, job: { status: "queued", progress: 0, attempts: 1 }, progress: 0 }), "HD processing");
  assert.equal(processingLine({ status: "ready", hdPending: false, job: running, progress: 100 }), null);
  assert.equal(progressFor("ready", running, true), 64);
  assert.equal(progressFor("ready", { status: "queued", progress: 30, attempts: 1 }, true), 0);
  assert.equal(progressFor("ready", null, true), 100);
  assert.equal(isWaiting({ status: "ready", hdPending: true }), true);
  assert.equal(isWaiting({ status: "ready" }), false);
  assert.equal(isWaiting({ status: "processing" }), true);
});

test("038: the video plays at low quality first and stays ready when only its HD fails", async () => {
  const { readFileSync } = await import("node:fs");
  const sql = readFileSync(new URL("../supabase/migrations/038_sd_first.sql", import.meta.url), "utf8");
  assert.match(sql, /add column if not exists hd_pending boolean not null default false/);
  // encode_sd_ready: ready with hd_pending, the job keeps running.
  const sd = sql.slice(sql.indexOf("function public.encode_sd_ready"), sql.indexOf("function public.encode_done"));
  assert.match(sd, /hd_pending = true/);
  assert.doesNotMatch(sd, /update public\.encode_jobs/);
  assert.match(sql, /set status = 'ready',\s+hd_pending = false/);
  // A final failure after the low quality is out only gives up HD.
  assert.match(sql, /where v\.id = job\.video_id and v\.status = 'ready' and v\.hd_pending;\s+if not found then/);
  // The claim hands out the HD part of a ready video, says so, and leaves the video ready.
  assert.match(sql, /v\.status in \('uploaded', 'processing'\) or \(v\.status = 'ready' and v\.hd_pending\)/);
  assert.match(sql, /hd_only boolean/);
  assert.match(sql, /if not \(vid\.status = 'ready' and vid\.hd_pending\) then/);
  // Private videos stay private.
  assert.match(sql, /v\.visibility <> 'private' or v\.owner_id = \(select auth\.uid\(\)\)/);
  for (const fn of ["encode_sd_ready(uuid, numeric, int, int, text, text, text, jsonb)", "encode_done(uuid, numeric, int, int, text, text, text, jsonb)", "claim_encode_job(text)"]) {
    assert.ok(sql.includes(`revoke execute on function public.${fn} from public, anon, authenticated`), fn);
    assert.ok(sql.includes(`grant execute on function public.${fn} to service_role`), fn);
  }
  assert.ok(sql.includes("grant execute on function public.video_hd_pending(uuid) to anon, authenticated, service_role"));
});

test("the upload page says Processing right away, then follows the encoder", () => {
  const base = { error: null };
  assert.deepEqual(uploadStatusText({ ...base, status: "uploaded", job: null, progress: 0 }), {
    title: "Processing...",
    line: "Waiting to process",
    pct: 0,
  });
  assert.deepEqual(uploadStatusText({ ...base, status: "uploaded", job: { status: "queued", progress: 0, attempts: 0 }, progress: 0 }).line, "Waiting to process");
  const running = { status: "running", progress: 12, attempts: 1 };
  assert.deepEqual(uploadStatusText({ ...base, status: "processing", job: running, progress: 12 }), {
    title: "Processing...",
    line: "Processing, 12%",
    pct: 12,
  });
  assert.deepEqual(uploadStatusText({ ...base, status: "ready", hdPending: true, job: { ...running, progress: 64 }, progress: 64 }), {
    title: "Your video can be watched now",
    line: "HD processing, 64%",
    pct: 64,
  });
  assert.deepEqual(uploadStatusText({ ...base, status: "ready", job: null, progress: 100 }), {
    title: "Processing done. Your video is ready.",
    line: null,
    pct: null,
  });
  assert.equal(uploadStatusText({ status: "failed", job: null, progress: null, error: "not a video" }).line, "not a video");
});
