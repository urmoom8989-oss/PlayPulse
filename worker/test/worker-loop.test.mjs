// The worker loop end to end with the Supabase client and the S3 client
// mocked, and a fake ffmpeg/ffprobe that writes the files a real encode would.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { test } from "node:test";
import { createDb } from "../lib/db.mjs";
import { runLoop, tick } from "../lib/loop.mjs";
import { createR2Client, createStorage } from "../lib/storage.mjs";
import { whisperJson } from "./whisper-fake.mjs";

const VIDEO = "aaaaaaaa-bbbb-cccc-dddd-000000000001";
const OWNER = "11111111-2222-3333-4444-555555555555";
const KEY = `uploads/${OWNER}/${VIDEO}/source.mp4`;
const BYTES = 4096;

/** A Supabase client whose rpc() behaves like the functions in 006_processing.sql. */
function fakeSupabase({ jobs = [], claimError = null, progressAnswer = null, sdFirst = false } = {}) {
  const calls = [];
  const rows = jobs.map((j, i) => ({
    job_id: `00000000-0000-0000-0000-00000000000${i + 1}`,
    video_id: VIDEO,
    owner_id: OWNER,
    source_key: KEY,
    source_bytes: BYTES,
    source_mime: "video/mp4",
    status: "queued",
    attempts: 0,
    ...j,
  }));
  const byId = (id) => rows.find((r) => r.job_id === id);
  return {
    calls,
    rows,
    async rpc(name, args) {
      calls.push({ name, args });
      switch (name) {
        case "claim_encode_job": {
          if (claimError) return { data: null, error: { message: claimError } };
          const job = rows.find((r) => r.status === "queued");
          if (!job) return { data: [], error: null };
          job.status = "running";
          job.attempts++;
          job.worker = args.worker;
          const row = {
            job_id: job.job_id,
            video_id: job.video_id,
            owner_id: job.owner_id,
            source_key: job.source_key,
            // PostgREST sends bigint as a string when it is big; the worker must cope.
            source_bytes: String(job.source_bytes),
            source_mime: job.source_mime,
            attempt: job.attempts,
            // 038 and later answer hd_only too.
            ...(sdFirst ? { hd_only: job.hdOnly === true } : {}),
          };
          return { data: [row], error: null };
        }
        case "encode_progress": {
          const job = byId(args.job_id);
          job.progress = args.pct;
          return { data: progressAnswer ?? job.status === "running", error: null };
        }
        case "encode_done":
          byId(args.job_id).status = "done";
          return { data: "done", error: null };
        case "encode_sd_ready":
          byId(args.job_id).sdReady = args;
          return { data: "ready", error: null };
        case "encode_failed": {
          const job = byId(args.job_id);
          job.error = args.error;
          job.status = args.retry && job.attempts < 3 ? "queued" : "failed";
          return { data: job.status, error: null };
        }
        default:
          return { data: null, error: { message: `unknown rpc ${name}` } };
      }
    },
  };
}

/** The real storage code on an S3 client whose send() is mocked. */
function fakeR2({ size = BYTES } = {}) {
  const client = createR2Client({ accountId: "example", accessKeyId: "test-key-id", secretAccessKey: "test-secret" });
  const sent = [];
  const puts = new Map();
  client.send = async (command) => {
    const name = command.constructor.name;
    const input = command.input;
    sent.push({ name, key: input.Key });
    if (name === "HeadObjectCommand") {
      if (size === null) throw Object.assign(new Error("NotFound"), { name: "NotFound", $metadata: { httpStatusCode: 404 } });
      return { ContentLength: size };
    }
    if (name === "GetObjectCommand") {
      // A file that was put (or seeded) comes back as itself; the source is any bytes.
      const put = puts.get(input.Key);
      if (put) return { Body: { transformToString: async () => put.text } };
      if (input.Key.startsWith("hls/")) throw Object.assign(new Error("NoSuchKey"), { name: "NoSuchKey", $metadata: { httpStatusCode: 404 } });
      return { Body: Readable.from([Buffer.alloc(BYTES, 1)]) };
    }
    if (name === "PutObjectCommand") {
      // Small files come as a Buffer (so a retry can send them again), big ones as a stream.
      const chunks = [];
      for await (const c of Buffer.isBuffer(input.Body) ? [input.Body] : input.Body) chunks.push(c);
      const body = Buffer.concat(chunks);
      puts.set(input.Key, { type: input.ContentType, cache: input.CacheControl, bytes: body.length, text: body.toString("utf8") });
      return {};
    }
    throw new Error("unexpected " + name);
  };
  return { storage: createStorage(client, "videos-test"), sent, puts };
}

const PROBE = JSON.stringify({
  format: { duration: "12.0" },
  streams: [
    { codec_type: "video", codec_name: "h264", width: 1280, height: 720, avg_frame_rate: "30/1" },
    { codec_type: "audio", codec_name: "aac" },
  ],
});

/**
 * Stands in for ffprobe and ffmpeg. The encode writes what the real one
 * would (per variant playlists, init and segments, master, sprite) and
 * reports progress; a thumbnail run writes its output file.
 */
function fakeRun({ failEncode = 0, hang = false, probe = PROBE, whisper = null, quietFrom = Infinity } = {}) {
  const runs = [];
  let encodes = 0;
  let heard = 0;
  const fn = async (cmd, args, { cwd, signal, onStdout } = {}) => {
    runs.push({ cmd, args });
    if (cmd === "ffprobe") return probe;
    // whisper-cli: `whisper(n, args, signal)` gives the JSON of its nth run, or throws.
    if (cmd === "whisper-cli") {
      const json = await whisper(heard++, args, signal);
      await writeFile(`${args[args.indexOf("-of") + 1]}.json`, json);
      return "";
    }
    const isEncode = args.includes("-filter_complex");
    if (!isEncode) {
      const output = args.at(-1);
      // A piece of sound for the captions: `quietFrom` (seconds) on, the sound track has ended.
      if (output.endsWith(".wav")) {
        const startS = Number(args[args.indexOf("-ss") + 1]);
        await writeFile(output, startS >= quietFrom ? Buffer.alloc(44) : Buffer.alloc(44 + 32000));
        return "";
      }
      await writeFile(output, "webp");
      return "";
    }
    encodes++;
    if (hang) {
      await new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
    }
    if (encodes <= failEncode) throw new Error("ffmpeg exited with 1: Conversion failed!");
    const names = args[args.indexOf("-var_stream_map") + 1].split(" ").map((s) => s.split("name:")[1]);
    for (const n of names) {
      await mkdir(join(cwd, n), { recursive: true });
      await writeFile(join(cwd, n, "index.m3u8"), "#EXTM3U\n");
      await writeFile(join(cwd, n, "init_0.mp4"), "init");
      await writeFile(join(cwd, n, "seg_00000.m4s"), "seg");
    }
    const master = args[args.indexOf("-master_pl_name") + 1];
    await writeFile(join(cwd, master), `#EXTM3U\n#EXT-X-VERSION:7\n${names.map((n) => `#EXT-X-STREAM-INF:BANDWIDTH=1000000,RESOLUTION=${n}\n${n}/index.m3u8\n`).join("")}`);
    if (args.includes("[spr]")) await writeFile(join(cwd, "sprite.webp"), "sprite");
    for (const us of [3000000, 6000000, 12000000]) onStdout?.(`out_time_us=${us}\nprogress=continue\n`);
    onStdout?.("progress=end\n");
    return "";
  };
  fn.runs = runs;
  return fn;
}

async function setup(opts = {}) {
  const workDir = await mkdtemp(join(tmpdir(), "sloptube-worker-test-"));
  const stateDir = await mkdtemp(join(tmpdir(), "sloptube-worker-state-"));
  const supabase = fakeSupabase(opts);
  const r2 = fakeR2(opts);
  const lines = [];
  const run = fakeRun(opts);
  const busySeen = [];
  const deps = {
    db: createDb(supabase),
    storage: r2.storage,
    run: async (...a) => {
      busySeen.push(existsSync(join(stateDir, "busy")));
      return run(...a);
    },
    log: (step, fields, text) => lines.push(`${step} ${text ?? ""}`),
    config: { workerName: "test-box", workDir, stateDir, mediaPublicUrl: opts.mediaPublicUrl ?? null, captions: opts.captions ?? null },
    diskFree: async () => opts.free ?? 100 * 1024 ** 3,
    progressEveryMs: 0,
    timeoutMs: opts.timeoutMs,
    captionsTimeoutMs: opts.captionsTimeoutMs,
  };
  const cleanup = () => Promise.all([rm(workDir, { recursive: true, force: true }), rm(stateDir, { recursive: true, force: true })]);
  return { deps, supabase, r2, lines, run, workDir, stateDir, busySeen, cleanup };
}

const rpcNames = (s) => s.supabase.calls.map((c) => c.name);

test("claim, progress, upload and done", async () => {
  const s = await setup({ jobs: [{}], mediaPublicUrl: "https://media.example.com" });
  try {
    assert.equal(await tick(s.deps), "done");

    const names = rpcNames(s);
    assert.equal(names[0], "claim_encode_job");
    assert.equal(s.supabase.calls[0].args.worker, "test-box");
    assert.equal(names.at(-1), "encode_done");
    assert.ok(!names.includes("encode_failed"));

    // Progress only goes up, stays below 100 and passes through the encode share.
    const pcts = s.supabase.calls.filter((c) => c.name === "encode_progress").map((c) => c.args.pct);
    assert.deepEqual([...pcts].sort((a, b) => a - b), pcts);
    assert.ok(pcts.includes(47) && pcts.includes(90) && pcts.at(-1) === 99, `progress was ${pcts}`);

    const done = s.supabase.calls.at(-1).args;
    assert.deepEqual(done, {
      job_id: "00000000-0000-0000-0000-000000000001",
      duration_s: 12,
      width: 1280,
      height: 720,
      hls_key: `hls/${VIDEO}/master.m3u8`,
      thumbnail_url: `https://media.example.com/hls/${VIDEO}/thumb-1.webp`,
      preview_sprite_key: `hls/${VIDEO}/sprite.vtt`,
      renditions: [
        { name: "360p", width: 640, height: 360, video_kbps: 800, audio_kbps: 96, playlist: "360p/index.m3u8" },
        { name: "720p", width: 1280, height: 720, video_kbps: 2800, audio_kbps: 128, playlist: "720p/index.m3u8" },
      ],
    });

    // The source was checked before it was downloaded.
    assert.deepEqual(s.r2.sent.slice(0, 2).map((x) => x.name), ["HeadObjectCommand", "GetObjectCommand"]);
    const keys = [...s.r2.puts.keys()].sort();
    assert.deepEqual(keys, [
      `hls/${VIDEO}/360p/index.m3u8`,
      `hls/${VIDEO}/360p/init_0.mp4`,
      `hls/${VIDEO}/360p/seg_00000.m4s`,
      `hls/${VIDEO}/720p/index.m3u8`,
      `hls/${VIDEO}/720p/init_0.mp4`,
      `hls/${VIDEO}/720p/seg_00000.m4s`,
      `hls/${VIDEO}/master.m3u8`,
      `hls/${VIDEO}/sprite.vtt`,
      `hls/${VIDEO}/sprite.webp`,
      `hls/${VIDEO}/thumb-1.webp`,
      `hls/${VIDEO}/thumb-2.webp`,
      `hls/${VIDEO}/thumb-3.webp`,
    ]);
    assert.equal(s.r2.puts.get(`hls/${VIDEO}/master.m3u8`).type, "application/vnd.apple.mpegurl");
    assert.equal(s.r2.puts.get(`hls/${VIDEO}/master.m3u8`).cache, "public, max-age=60");
    assert.equal(s.r2.puts.get(`hls/${VIDEO}/360p/index.m3u8`).cache, "public, max-age=300");
    assert.equal(s.r2.puts.get(`hls/${VIDEO}/360p/seg_00000.m4s`).type, "video/iso.segment");
    assert.match(s.r2.puts.get(`hls/${VIDEO}/360p/seg_00000.m4s`).cache, /immutable/);
    assert.equal(s.r2.puts.get(`hls/${VIDEO}/sprite.vtt`).type, "text/vtt; charset=utf-8");

    // Thumbnails at 10%, 50% and 90% of 12 s.
    const seeks = s.run.runs.filter((r) => r.args.includes("-ss")).map((r) => r.args[r.args.indexOf("-ss") + 1]);
    assert.deepEqual(seeks, ["1.200", "6.000", "10.800"]);

    // One line per step, the temp folder is gone and so is the busy marker.
    for (const step of ["claim", "head", "disk", "download", "probe", "encode", "thumbnails", "upload", "done", "cleanup"]) {
      assert.ok(s.lines.some((l) => l.startsWith(step + " ")), `no ${step} line in\n${s.lines.join("\n")}`);
    }
    assert.deepEqual(await readdir(s.workDir), []);
    assert.ok(s.busySeen.every(Boolean), "busy marker was missing during the job");
    assert.equal(existsSync(join(s.stateDir, "busy")), false);
  } finally {
    await s.cleanup();
  }
});

const PROBE_1080 = JSON.stringify({
  format: { duration: "12.0" },
  streams: [
    { codec_type: "video", codec_name: "h264", width: 1920, height: 1080, avg_frame_rate: "30/1" },
    { codec_type: "audio", codec_name: "aac" },
  ],
});
const encodeRuns = (s) => s.run.runs.filter((r) => r.args.includes("-filter_complex"));
const streamNames = (r) => r.args[r.args.indexOf("-var_stream_map") + 1].split(" ").map((x) => x.split("name:")[1]);
const variantsIn = (text) => text.split("\n").filter((l) => l && !l.startsWith("#"));

test("low quality first: 360p plays, then 720p and 1080p are added to the same master", async () => {
  const s = await setup({ jobs: [{}], sdFirst: true, probe: PROBE_1080, mediaPublicUrl: "https://media.example.com" });
  try {
    assert.equal(await tick(s.deps), "done");

    // Two encodes: the low ladder with the sprite, then HD with its own master.
    const runs = encodeRuns(s);
    assert.equal(runs.length, 2);
    assert.deepEqual(streamNames(runs[0]), ["360p"]);
    assert.ok(runs[0].args.includes("[spr]"));
    assert.equal(runs[0].args[runs[0].args.indexOf("-master_pl_name") + 1], "master.m3u8");
    assert.deepEqual(streamNames(runs[1]), ["720p", "1080p"]);
    assert.ok(!runs[1].args.includes("[spr]"));
    assert.equal(runs[1].args[runs[1].args.indexOf("-master_pl_name") + 1], "hd-master.m3u8");

    // Ready at low quality first, then done with every rendition.
    const names = rpcNames(s);
    const sdAt = names.indexOf("encode_sd_ready");
    assert.ok(sdAt > 0 && sdAt < names.indexOf("encode_done"), names.join(" "));
    assert.equal(names.at(-1), "encode_done");
    const sd = s.supabase.calls[sdAt].args;
    assert.deepEqual(sd.renditions.map((r) => r.name), ["360p"]);
    assert.deepEqual([sd.width, sd.height], [640, 360]);
    assert.equal(sd.hls_key, `hls/${VIDEO}/master.m3u8`);
    assert.equal(sd.thumbnail_url, `https://media.example.com/hls/${VIDEO}/thumb-1.webp`);
    const done = s.supabase.calls.at(-1).args;
    assert.deepEqual(done.renditions.map((r) => r.name), ["360p", "720p", "1080p"]);
    assert.deepEqual([done.width, done.height], [1920, 1080]);

    // The sd call came after every low file was stored, and before any HD file.
    const putKeys = s.r2.sent.filter((x) => x.name === "PutObjectCommand").map((x) => x.key);
    const firstHd = putKeys.findIndex((k) => k.includes("/720p/") || k.includes("/1080p/"));
    assert.ok(putKeys.slice(0, firstHd).includes(`hls/${VIDEO}/360p/seg_00000.m4s`));
    assert.ok(putKeys.slice(0, firstHd).includes(`hls/${VIDEO}/master.m3u8`));
    // The merged master goes up after every HD file, and the HD master never does.
    assert.equal(putKeys.at(-1), `hls/${VIDEO}/master.m3u8`);
    assert.ok(!putKeys.some((k) => k.endsWith("hd-master.m3u8")), putKeys.join("\n"));
    assert.deepEqual(variantsIn(s.r2.puts.get(`hls/${VIDEO}/master.m3u8`).text), ["360p/index.m3u8", "720p/index.m3u8", "1080p/index.m3u8"]);
    for (const k of ["720p/index.m3u8", "720p/seg_00000.m4s", "1080p/init_0.mp4", "sprite.webp", "thumb-3.webp"]) {
      assert.ok(s.r2.puts.has(`hls/${VIDEO}/${k}`), `${k} was not stored`);
    }

    // The bar fills once: the low part ends at 30, HD to 99.
    const pcts = s.supabase.calls.filter((c) => c.name === "encode_progress").map((c) => c.args.pct);
    assert.deepEqual([...pcts].sort((a, b) => a - b), pcts);
    assert.ok(pcts.includes(25) && pcts.includes(30) && pcts.includes(92) && pcts.at(-1) === 99, `progress was ${pcts}`);
    assert.ok(s.lines.some((l) => l.startsWith("sd ") && l.includes("360p playable")), s.lines.join("\n"));
    assert.deepEqual(await readdir(s.workDir), []);
  } finally {
    await s.cleanup();
  }
});

test("without 038 (no hd_only from the claim) a 1080p source gets one run as before", async () => {
  const s = await setup({ jobs: [{}], probe: PROBE_1080 });
  try {
    assert.equal(await tick(s.deps), "done");
    assert.equal(encodeRuns(s).length, 1);
    assert.deepEqual(streamNames(encodeRuns(s)[0]), ["360p", "720p", "1080p"]);
    assert.ok(!rpcNames(s).includes("encode_sd_ready"));
  } finally {
    await s.cleanup();
  }
});

test("a source with nothing to split (no HD) gets one run and no sd step", async () => {
  const probe = PROBE.replace('"width":1280,"height":720', '"width":640,"height":360');
  assert.notEqual(probe, PROBE);
  const s = await setup({ jobs: [{}], sdFirst: true, probe });
  try {
    assert.equal(await tick(s.deps), "done");
    assert.equal(encodeRuns(s).length, 1);
    assert.deepEqual(streamNames(encodeRuns(s)[0]), ["360p"]);
    assert.ok(!rpcNames(s).includes("encode_sd_ready"));
    assert.equal(rpcNames(s).at(-1), "encode_done");
  } finally {
    await s.cleanup();
  }
});

test("a retry of the HD part makes only HD and merges it into the stored master", async () => {
  const s = await setup({ jobs: [{ hdOnly: true }], sdFirst: true, probe: PROBE_1080 });
  try {
    const stored = "#EXTM3U\n#EXT-X-VERSION:7\n#EXT-X-STREAM-INF:BANDWIDTH=1000000,RESOLUTION=640x360\n360p/index.m3u8\n";
    s.r2.puts.set(`hls/${VIDEO}/master.m3u8`, { text: stored });
    assert.equal(await tick(s.deps), "done");

    const runs = encodeRuns(s);
    assert.equal(runs.length, 1);
    assert.deepEqual(streamNames(runs[0]), ["720p", "1080p"]);
    // No thumbnails or sprite again, and the low files stay as they are.
    assert.ok(!s.run.runs.some((r) => r.args.includes("-ss")));
    const putKeys = s.r2.sent.filter((x) => x.name === "PutObjectCommand").map((x) => x.key);
    assert.ok(!putKeys.some((k) => k.includes("/360p/") || k.includes("thumb-") || k.includes("sprite")), putKeys.join("\n"));
    assert.ok(s.r2.sent.some((x) => x.name === "GetObjectCommand" && x.key === `hls/${VIDEO}/master.m3u8`));
    assert.deepEqual(variantsIn(s.r2.puts.get(`hls/${VIDEO}/master.m3u8`).text), ["360p/index.m3u8", "720p/index.m3u8", "1080p/index.m3u8"]);

    assert.ok(!rpcNames(s).includes("encode_sd_ready"));
    const done = s.supabase.calls.at(-1);
    assert.equal(done.name, "encode_done");
    assert.deepEqual(done.args.renditions.map((r) => r.name), ["360p", "720p", "1080p"]);
    assert.ok(s.lines.some((l) => l.startsWith("claim ") && l.includes("HD only")));
  } finally {
    await s.cleanup();
  }
});

test("a retry of the HD part whose low master is gone fails without another retry", async () => {
  const s = await setup({ jobs: [{ hdOnly: true }], sdFirst: true, probe: PROBE_1080 });
  try {
    assert.equal(await tick(s.deps), "failed");
    const failed = s.supabase.calls.find((c) => c.name === "encode_failed").args;
    assert.equal(failed.retry, false);
    assert.match(failed.error, /low quality master playlist is gone/);
  } finally {
    await s.cleanup();
  }
});

test("without MEDIA_PUBLIC_URL the thumbnail url stays empty", async () => {
  const s = await setup({ jobs: [{}] });
  try {
    assert.equal(await tick(s.deps), "done");
    assert.equal(s.supabase.calls.at(-1).args.thumbnail_url, null);
  } finally {
    await s.cleanup();
  }
});

test("nothing queued: idle, no R2 calls", async () => {
  const s = await setup({ jobs: [] });
  try {
    assert.equal(await tick(s.deps), "idle");
    assert.deepEqual(s.r2.sent, []);
  } finally {
    await s.cleanup();
  }
});

test("the database cannot be reached: error, no job", async () => {
  const s = await setup({ jobs: [{}], claimError: "fetch failed" });
  try {
    assert.equal(await tick(s.deps), "error");
    assert.ok(s.lines.some((l) => l.includes("could not ask for a job: claim_encode_job: fetch failed")));
  } finally {
    await s.cleanup();
  }
});

test("a source whose size does not match the upload is refused without a retry or a download", async () => {
  const s = await setup({ jobs: [{}], size: BYTES - 1 });
  try {
    assert.equal(await tick(s.deps), "failed");
    const failed = s.supabase.calls.find((c) => c.name === "encode_failed").args;
    assert.equal(failed.retry, false);
    assert.match(failed.error, /does not match/);
    assert.ok(!s.r2.sent.some((x) => x.name === "GetObjectCommand"));
  } finally {
    await s.cleanup();
  }
});

test("a missing source is refused without a retry", async () => {
  const s = await setup({ jobs: [{}], size: null });
  try {
    assert.equal(await tick(s.deps), "failed");
    assert.match(s.supabase.rows[0].error, /not in storage/);
  } finally {
    await s.cleanup();
  }
});

test("not enough disk: failed for now, tried again later", async () => {
  const s = await setup({ jobs: [{}], free: 1024 });
  try {
    assert.equal(await tick(s.deps), "queued");
    assert.match(s.supabase.rows[0].error, /not enough disk/);
    assert.ok(!s.r2.sent.some((x) => x.name === "GetObjectCommand"));
  } finally {
    await s.cleanup();
  }
});

test("a broken encode is retried, and works on the second attempt", async () => {
  const s = await setup({ jobs: [{}], failEncode: 1 });
  try {
    assert.equal(await tick(s.deps), "queued");
    const failed = s.supabase.calls.find((c) => c.name === "encode_failed").args;
    assert.equal(failed.retry, true);
    assert.match(failed.error, /Conversion failed/);
    assert.deepEqual(await readdir(s.workDir), [], "temp folder left behind after a failure");

    assert.equal(await tick(s.deps), "done");
    assert.equal(s.supabase.rows[0].attempts, 2);
    assert.equal(s.supabase.rows[0].status, "done");
  } finally {
    await s.cleanup();
  }
});

test("three broken encodes fail the video", async () => {
  const s = await setup({ jobs: [{}], failEncode: 5 });
  try {
    assert.equal(await tick(s.deps), "queued");
    assert.equal(await tick(s.deps), "queued");
    assert.equal(await tick(s.deps), "failed");
    assert.equal(await tick(s.deps), "idle");
    assert.equal(s.supabase.rows[0].status, "failed");
    assert.equal(s.supabase.rows[0].attempts, 3);
  } finally {
    await s.cleanup();
  }
});

test("a job over the time limit is stopped and failed without a retry", async () => {
  const s = await setup({ jobs: [{}], hang: true, timeoutMs: 50 });
  try {
    assert.equal(await tick(s.deps), "failed");
    const failed = s.supabase.calls.find((c) => c.name === "encode_failed").args;
    assert.equal(failed.retry, false);
    assert.equal(failed.error, "took longer than 1 second");
  } finally {
    await s.cleanup();
  }
});

test("a job the database took back stops without reporting", async () => {
  const s = await setup({ jobs: [{}], progressAnswer: false });
  try {
    assert.equal(await tick(s.deps), "lost");
    assert.ok(!rpcNames(s).includes("encode_failed"));
    assert.ok(!rpcNames(s).includes("encode_done"));
  } finally {
    await s.cleanup();
  }
});

test("the loop runs jobs one after another and stops on the signal", async () => {
  const s = await setup({ jobs: [{}, {}] });
  try {
    const stop = new AbortController();
    let claims = 0;
    const db = s.deps.db;
    const counted = {
      ...db,
      claim: async (w) => {
        claims++;
        const job = await db.claim(w);
        if (!job && claims >= 3) stop.abort();
        return job;
      },
    };
    await mkdir(join(s.workDir, "job-left-by-a-crash"));
    await runLoop({ ...s.deps, db: counted, stopSignal: stop.signal, pollMs: 10 });
    assert.deepEqual(await readdir(s.workDir), []);
    assert.ok(s.lines.some((l) => l.includes("removed 1 old job folders")));
    assert.deepEqual(s.supabase.rows.map((r) => r.status), ["done", "done"]);
    assert.equal(claims, 3);
    assert.ok(s.lines.at(-1).startsWith("stop "));
  } finally {
    await s.cleanup();
  }
});

const CAPTIONS = { bin: "whisper-cli", model: "/m/speech.bin", vadModel: "/m/vad.bin", threads: 2 };
const captionKeys = (s) => [...s.r2.puts.keys()].filter((k) => k.includes("/captions/")).sort();

test("captions: after encode_done, the words go up as WebVTT and the master playlist names them", async () => {
  const s = await setup({
    jobs: [{}],
    captions: CAPTIONS,
    whisper: async () => whisperJson("en", [[500, 3000, " Hello and welcome back."], [3000, 4000, " [BLANK_AUDIO]"], [4000, 7500, " Today we play a game."]]),
  });
  try {
    let putsAtDone = -1;
    const done = s.deps.db.done;
    s.deps.db.done = async (...a) => {
      putsAtDone = s.r2.sent.filter((x) => x.name === "PutObjectCommand").length;
      return done(...a);
    };
    assert.equal(await tick(s.deps), "done");

    assert.deepEqual(captionKeys(s), [`hls/${VIDEO}/captions/en.m3u8`, `hls/${VIDEO}/captions/en.vtt`]);
    const vtt = s.r2.puts.get(`hls/${VIDEO}/captions/en.vtt`);
    assert.equal(vtt.type, "text/vtt; charset=utf-8");
    assert.equal(vtt.text, "WEBVTT\n\n00:00:00.500 --> 00:00:03.000\nHello and welcome back.\n\n00:00:04.000 --> 00:00:07.500\nToday we play a game.\n");
    assert.match(s.r2.puts.get(`hls/${VIDEO}/captions/en.m3u8`).text, /#EXTINF:12\.000,\nen\.vtt\n/);

    const master = s.r2.puts.get(`hls/${VIDEO}/master.m3u8`).text;
    assert.match(master, /#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="English \(auto-generated\)",LANGUAGE="en",.*URI="captions\/en.m3u8"/);
    assert.equal(master.match(/SUBTITLES="subs"/g).length, 2);

    // The video was ready before any caption file went up, and the master went up again last.
    const puts = s.r2.sent.filter((x) => x.name === "PutObjectCommand").map((x) => x.key);
    assert.ok(putsAtDone > 0 && puts.slice(0, putsAtDone).every((k) => !k.includes("/captions/")), "captions before encode_done");
    assert.deepEqual(puts.slice(putsAtDone), [`hls/${VIDEO}/captions/en.vtt`, `hls/${VIDEO}/captions/en.m3u8`, `hls/${VIDEO}/master.m3u8`]);

    // Whisper got the 16 kHz piece of sound and the voice detection model; the first run guesses the language.
    const w = s.run.runs.find((r) => r.cmd === "whisper-cli").args;
    assert.equal(w[w.indexOf("-l") + 1], "auto");
    assert.equal(w[w.indexOf("-vm") + 1], "/m/vad.bin");
    assert.equal(w[w.indexOf("-t") + 1], "2");
    assert.ok(s.lines.some((l) => l.startsWith("captions English (auto-generated) in ")), s.lines.join("\n"));
    assert.deepEqual(await readdir(s.workDir), []);
  } finally {
    await s.cleanup();
  }
});

test("captions: a long video is heard in pieces, in the language of the first piece with speech", async () => {
  const probe = JSON.stringify({
    format: { duration: "2000.0" },
    streams: [
      { codec_type: "video", codec_name: "h264", width: 640, height: 360, avg_frame_rate: "30/1" },
      { codec_type: "audio", codec_name: "aac" },
    ],
  });
  const s = await setup({
    jobs: [{}],
    probe,
    captions: CAPTIONS,
    whisper: async (n) =>
      n === 0 ? whisperJson("ja", []) : whisperJson(n === 1 ? "fr" : "en", [[1000, 2000, n === 1 ? " Bonjour." : " Au revoir."]]),
  });
  try {
    assert.equal(await tick(s.deps), "done");
    const runs = s.run.runs.filter((r) => r.cmd === "whisper-cli").map((r) => r.args[r.args.indexOf("-l") + 1]);
    assert.deepEqual(runs, ["auto", "auto", "fr"]);
    assert.deepEqual(await readdir(s.workDir), []);
    const seeks = s.run.runs.filter((r) => r.args.includes("pcm_s16le")).map((r) => r.args[r.args.indexOf("-ss") + 1]);
    assert.deepEqual(seeks, ["0.000", "900.000", "1800.000"]);
    assert.deepEqual(captionKeys(s), [`hls/${VIDEO}/captions/fr.m3u8`, `hls/${VIDEO}/captions/fr.vtt`]);
    assert.equal(
      s.r2.puts.get(`hls/${VIDEO}/captions/fr.vtt`).text,
      "WEBVTT\n\n00:15:01.000 --> 00:15:02.000\nBonjour.\n\n00:30:01.000 --> 00:30:02.000\nAu revoir.\n",
    );
    assert.match(s.r2.puts.get(`hls/${VIDEO}/master.m3u8`).text, /NAME="French \(auto-generated\)",LANGUAGE="fr"/);
  } finally {
    await s.cleanup();
  }
});

test("captions: when whisper breaks, the video is still done and has none", async () => {
  const s = await setup({
    jobs: [{}],
    captions: CAPTIONS,
    whisper: async () => {
      throw new Error("whisper-cli exited with 10: failed to process audio");
    },
  });
  try {
    assert.equal(await tick(s.deps), "done");
    assert.equal(s.supabase.rows[0].status, "done");
    assert.deepEqual(captionKeys(s), []);
    assert.doesNotMatch(s.r2.puts.get(`hls/${VIDEO}/master.m3u8`).text, /SUBTITLES/);
    assert.equal(s.r2.sent.filter((x) => x.key === `hls/${VIDEO}/master.m3u8`).length, 1);
    assert.ok(s.lines.some((l) => l === "captions no captions: whisper-cli exited with 10: failed to process audio"), s.lines.join("\n"));
    assert.deepEqual(await readdir(s.workDir), []);
  } finally {
    await s.cleanup();
  }
});

test("captions: speech to text over its time limit is stopped, the video stays done", async () => {
  const s = await setup({
    jobs: [{}],
    captions: CAPTIONS,
    captionsTimeoutMs: 50,
    whisper: (n, args, signal) => new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true })),
  });
  try {
    assert.equal(await tick(s.deps), "done");
    assert.deepEqual(captionKeys(s), []);
    assert.ok(s.lines.includes("captions no captions: took longer than 1 second"), s.lines.join("\n"));
  } finally {
    await s.cleanup();
  }
});

test("captions: no speech, no sound or captions off: nothing is added", async () => {
  const quiet = await setup({ jobs: [{}], captions: CAPTIONS, whisper: async () => whisperJson("en", [[0, 1000, " [BLANK_AUDIO]"]]) });
  const mute = JSON.stringify({
    format: { duration: "12.0" },
    streams: [{ codec_type: "video", codec_name: "h264", width: 1280, height: 720, avg_frame_rate: "30/1" }],
  });
  const silent = await setup({ jobs: [{}], probe: mute, captions: CAPTIONS, whisper: async () => assert.fail("whisper ran on a video without sound") });
  const off = await setup({ jobs: [{}], whisper: async () => assert.fail("whisper ran with captions off") });
  try {
    for (const s of [quiet, silent, off]) {
      assert.equal(await tick(s.deps), "done");
      assert.deepEqual(captionKeys(s), []);
      assert.doesNotMatch(s.r2.puts.get(`hls/${VIDEO}/master.m3u8`).text, /SUBTITLES/);
    }
    assert.ok(quiet.lines.some((l) => /^captions no speech found/.test(l)), quiet.lines.join("\n"));
    assert.ok(silent.lines.includes("captions the video has no sound, so no captions"), silent.lines.join("\n"));
    assert.ok(!off.lines.some((l) => l.startsWith("captions ")));
  } finally {
    await Promise.all([quiet.cleanup(), silent.cleanup(), off.cleanup()]);
  }
});

test("captions: pieces after the sound track ends are not sent to whisper", async () => {
  const probe = JSON.stringify({
    format: { duration: "2000.0" },
    streams: [
      { codec_type: "video", codec_name: "h264", width: 640, height: 360, avg_frame_rate: "30/1" },
      { codec_type: "audio", codec_name: "aac" },
    ],
  });
  const s = await setup({ jobs: [{}], probe, quietFrom: 900, captions: CAPTIONS, whisper: async () => whisperJson("en", [[1000, 2000, " Hi."]]) });
  try {
    assert.equal(await tick(s.deps), "done");
    assert.equal(s.run.runs.filter((r) => r.cmd === "whisper-cli").length, 1);
    assert.equal(s.r2.puts.get(`hls/${VIDEO}/captions/en.vtt`).text, "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHi.\n");
  } finally {
    await s.cleanup();
  }
});

test("two slots process two videos at the same time, each under its own name, with heartbeats", async () => {
  const s = await setup({ jobs: [{}, {}] });
  try {
    const stop = new AbortController();
    const db = s.deps.db;
    const names = [];
    const beats = [];
    let inFlight = 0;
    let most = 0;
    const run = s.deps.run;
    const counted = {
      ...db,
      claim: async (w) => {
        names.push(w);
        const job = await db.claim(w);
        // Stop once both videos are done (not when one slot is idle while the other still works).
        if (!job && s.supabase.rows.every((r) => r.status === "done")) stop.abort();
        return job;
      },
      heartbeat: async (id) => void beats.push(id),
      release: async (w) => {
        names.push(`release ${w}`);
        return 0;
      },
    };
    await runLoop({
      ...s.deps,
      db: counted,
      // Each encode takes a moment, so the two overlap.
      run: async (...a) => {
        inFlight++;
        most = Math.max(most, inFlight);
        await new Promise((r) => setTimeout(r, 30));
        try {
          return await run(...a);
        } finally {
          inFlight--;
        }
      },
      config: { ...s.deps.config, encodeSlots: 2 },
      stopSignal: stop.signal,
      pollMs: 10,
      heartbeatMs: 5,
    });
    assert.equal(names[0], "release test-box");
    assert.ok(names.includes("test-box/1") && names.includes("test-box/2"), names.join(", "));
    assert.ok(!names.includes("test-box"));
    assert.deepEqual(s.supabase.rows.map((r) => r.status), ["done", "done"]);
    assert.equal(most, 2, "the two encodes ran at the same time");
    assert.ok(beats.length > 0, "heartbeats while working");
    assert.ok(s.lines.some((l) => l.includes("2 videos at a time")));
  } finally {
    await s.cleanup();
  }
});

test("without 037 in the database, the worker keeps to one video at a time", async () => {
  const s = await setup({ jobs: [{}] });
  try {
    const stop = new AbortController();
    const db = s.deps.db;
    const names = [];
    const old = {
      ...db,
      release: async () => null,
      claim: async (w) => {
        names.push(w);
        const job = await db.claim(w);
        if (!job) stop.abort();
        return job;
      },
    };
    await runLoop({ ...s.deps, db: old, config: { ...s.deps.config, encodeSlots: 2 }, stopSignal: stop.signal, pollMs: 10 });
    assert.ok(names.every((n) => n === "test-box"), names.join(", "));
    assert.ok(s.lines.some((l) => l.includes("037_parallel_encodes.sql is not run yet")));
  } finally {
    await s.cleanup();
  }
});

test("slot names: the worker's own with one slot, /n with more", async () => {
  const { slotName } = await import("../lib/loop.mjs");
  assert.equal(slotName("box", 1, 1), "box");
  assert.equal(slotName("box", 1, 2), "box/1");
  assert.equal(slotName("box", 2, 2), "box/2");
});
