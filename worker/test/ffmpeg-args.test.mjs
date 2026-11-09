// The ffmpeg and ffprobe command lines, snapshotted, and the -progress parser.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildEncodeArgs,
  buildSpriteArgs,
  buildThumbnailArgs,
  createProgressParser,
  encodePercent,
  mergeMasters,
} from "../lib/ffmpeg.mjs";
import { pickRenditions } from "../lib/ladder.mjs";
import { buildProbeArgs, parseProbe } from "../lib/probe.mjs";
import { spritePlan } from "../lib/sprite.mjs";

// The full command for a 12 s 720p source with sound. If you change the
// encode on purpose, update this snapshot in the same commit.
const SNAPSHOT_720P = [
  "-hide_banner", "-nostdin", "-y", "-loglevel", "error", "-nostats", "-progress", "pipe:1",
  "-i", "/work/job/source.mp4",
  "-filter_complex",
  "[0:v]split=3[s0][s1][sp];" +
    "[s0]scale=640:360:flags=bicubic,setsar=1,format=yuv420p[v0];" +
    "[s1]scale=1280:720:flags=bicubic,setsar=1,format=yuv420p[v1];" +
    "[sp]fps=1/5,scale=160:90:force_original_aspect_ratio=decrease,pad=160:90:(ow-iw)/2:(oh-ih)/2,setsar=1[spr]",
  "-map", "[v0]", "-map", "0:a:0",
  "-map", "[v1]", "-map", "0:a:0",
  "-c:v", "libx264", "-preset", "veryfast", "-profile:v", "high",
  "-sc_threshold", "0", "-force_key_frames", "expr:gte(t,n_forced*4)",
  "-b:v:0", "800k", "-maxrate:v:0", "856k", "-bufsize:v:0", "1200k",
  "-b:v:1", "2800k", "-maxrate:v:1", "2996k", "-bufsize:v:1", "4200k",
  "-c:a", "aac", "-ac", "2", "-ar", "48000",
  "-b:a:0", "96k", "-b:a:1", "128k",
  "-f", "hls", "-hls_time", "4", "-hls_playlist_type", "vod",
  "-hls_segment_type", "fmp4", "-hls_flags", "independent_segments",
  "-hls_fmp4_init_filename", "init.mp4",
  "-hls_segment_filename", "%v/seg_%05d.m4s",
  "-master_pl_name", "master.m3u8",
  "-var_stream_map", "v:0,a:0,name:360p v:1,a:1,name:720p",
  "%v/index.m3u8",
  "-map", "[spr]", "-frames:v", "3", "-c:v", "png", "-f", "image2", "/work/job/sprite/%03d.png",
];

test("encode args for a 720p source with sound (snapshot)", () => {
  const args = buildEncodeArgs({
    input: "/work/job/source.mp4",
    renditions: pickRenditions({ width: 1280, height: 720 }),
    hasAudio: true,
    sprite: spritePlan(12),
    spriteFrames: "/work/job/sprite/%03d.png",
  });
  assert.deepEqual(args, SNAPSHOT_720P);
});

test("the sprite is not tiled inside the encode, so ffmpeg reports progress from the start", () => {
  const args = buildEncodeArgs({
    input: "in.mp4",
    renditions: pickRenditions({ width: 1280, height: 720 }),
    hasAudio: true,
    sprite: spritePlan(10693.4),
    spriteFrames: "/work/job/sprite/%03d.png",
  });
  assert.ok(!args[args.indexOf("-filter_complex") + 1].includes("tile="));
  assert.ok(!args.includes("libwebp"));
  assert.equal(args[args.indexOf("[spr]") + 2], "100");
});

test("a sprite without a place for its frames is a bug", () => {
  assert.throws(
    () => buildEncodeArgs({ input: "x", renditions: pickRenditions({ width: 640, height: 360 }), hasAudio: false, sprite: spritePlan(12) }),
    /spriteFrames/,
  );
});

test("sprite tiling args (snapshot)", () => {
  assert.deepEqual(buildSpriteArgs({ frames: "/work/job/sprite/%03d.png", plan: spritePlan(10693.4), output: "/work/job/out/sprite.webp" }), [
    "-hide_banner", "-nostdin", "-y", "-loglevel", "error",
    "-framerate", "1", "-start_number", "1", "-i", "/work/job/sprite/%03d.png",
    "-vf", "tile=10x10",
    "-frames:v", "1",
    "-c:v", "libwebp", "-quality", "70",
    "/work/job/out/sprite.webp",
  ]);
});

test("without sound there are no audio maps or codecs", () => {
  const args = buildEncodeArgs({
    input: "in.mov",
    renditions: pickRenditions({ width: 1920, height: 1080 }),
    hasAudio: false,
    sprite: null,
  });
  assert.ok(!args.includes("0:a:0"));
  assert.ok(!args.includes("-c:a"));
  assert.equal(args[args.indexOf("-var_stream_map") + 1], "v:0,name:360p v:1,name:720p v:2,name:1080p");
  assert.equal(args[args.indexOf("-filter_complex") + 1].split(";")[0], "[0:v]split=3[s0][s1][s2]");
  assert.equal(args.at(-1), "%v/index.m3u8");
});

test("no renditions is a bug, not an empty encode", () => {
  assert.throws(() => buildEncodeArgs({ input: "x", renditions: [], hasAudio: true }), /no renditions/);
});

test("thumbnail args (snapshot)", () => {
  assert.deepEqual(buildThumbnailArgs({ input: "/w/source.mp4", atSeconds: 1.2, output: "/w/out/thumb-1.webp" }), [
    "-hide_banner", "-nostdin", "-y", "-loglevel", "error",
    "-ss", "1.200", "-i", "/w/source.mp4", "-frames:v", "1",
    "-vf", "scale='min(1280,iw)':-2,setsar=1",
    "-c:v", "libwebp", "-quality", "80", "/w/out/thumb-1.webp",
  ]);
});

test("the progress parser reads out_time_us across chunk borders", () => {
  const times = [];
  let ended = false;
  const feed = createProgressParser((s) => times.push(s), () => (ended = true));
  feed("frame=10\nout_time_us=1500");
  feed("000\nspeed=2x\nprogress=continue\nout_time_ms=3000000\n");
  feed("out_time_us=N/A\nprogress=end\n");
  assert.deepEqual(times, [1.5, 3]);
  assert.equal(ended, true);
});

test("encode percent stays inside the encode share of the bar", () => {
  assert.equal(encodePercent(0, 100), 5);
  assert.equal(encodePercent(50, 100), 47);
  assert.equal(encodePercent(100, 100), 90);
  assert.equal(encodePercent(500, 100), 90);
  assert.equal(encodePercent(10, 0), 5);
});

test("encode percent can be given its own share (low quality first, then HD)", () => {
  assert.equal(encodePercent(0, 100, 5, 25), 5);
  assert.equal(encodePercent(50, 100, 5, 25), 15);
  assert.equal(encodePercent(100, 100, 30, 92), 92);
});

test("the HD run writes its own master playlist", () => {
  const source = { width: 1920, height: 1080, fps: 30 };
  const high = pickRenditions(source).filter((r) => r.height >= 720);
  const args = buildEncodeArgs({ input: "in.mp4", renditions: high, hasAudio: true, masterName: "hd-master.m3u8" });
  assert.equal(args[args.indexOf("-master_pl_name") + 1], "hd-master.m3u8");
  assert.equal(args[args.indexOf("-var_stream_map") + 1], "v:0,a:0,name:720p v:1,a:1,name:1080p");
  const plain = buildEncodeArgs({ input: "in.mp4", renditions: high, hasAudio: true });
  assert.equal(plain[plain.indexOf("-master_pl_name") + 1], "master.m3u8");
});

const SD_MASTER = [
  "#EXTM3U",
  "#EXT-X-VERSION:7",
  '#EXT-X-STREAM-INF:BANDWIDTH=1000000,RESOLUTION=640x360,CODECS="avc1.64001e,mp4a.40.2"',
  "360p/index.m3u8",
  "",
].join("\n");
const HD_MASTER = [
  "#EXTM3U",
  "#EXT-X-VERSION:7",
  '#EXT-X-STREAM-INF:BANDWIDTH=3100000,RESOLUTION=1280x720,CODECS="avc1.64001f,mp4a.40.2"',
  "720p/index.m3u8",
  "",
  '#EXT-X-STREAM-INF:BANDWIDTH=5500000,RESOLUTION=1920x1080,CODECS="avc1.640028,mp4a.40.2"',
  "1080p/index.m3u8",
  "",
].join("\n");

test("the HD variants are added to the low quality master, smallest first", () => {
  const merged = mergeMasters(SD_MASTER, HD_MASTER);
  assert.equal(
    merged,
    [
      "#EXTM3U",
      "#EXT-X-VERSION:7",
      '#EXT-X-STREAM-INF:BANDWIDTH=1000000,RESOLUTION=640x360,CODECS="avc1.64001e,mp4a.40.2"',
      "360p/index.m3u8",
      '#EXT-X-STREAM-INF:BANDWIDTH=3100000,RESOLUTION=1280x720,CODECS="avc1.64001f,mp4a.40.2"',
      "720p/index.m3u8",
      '#EXT-X-STREAM-INF:BANDWIDTH=5500000,RESOLUTION=1920x1080,CODECS="avc1.640028,mp4a.40.2"',
      "1080p/index.m3u8",
      "",
    ].join("\n"),
  );
  // Merging again (a retry) adds nothing twice.
  assert.equal(mergeMasters(merged, HD_MASTER), merged);
});

test("captions on the low quality master carry over to the HD variants", () => {
  const withSubs = SD_MASTER.replace(
    "#EXT-X-STREAM-INF:BANDWIDTH=1000000",
    '#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="English",LANGUAGE="en",URI="captions/en.m3u8"\n#EXT-X-STREAM-INF:BANDWIDTH=1000000',
  ).replace('mp4a.40.2"\n360p', 'mp4a.40.2",SUBTITLES="subs"\n360p');
  const merged = mergeMasters(withSubs, HD_MASTER).split("\n");
  const infs = merged.filter((l) => l.startsWith("#EXT-X-STREAM-INF:"));
  assert.equal(infs.length, 3);
  assert.ok(infs.every((l) => l.endsWith('SUBTITLES="subs"')), infs.join("\n"));
  assert.equal(merged.filter((l) => l.startsWith("#EXT-X-MEDIA:")).length, 1);
});

test("a master that is not a playlist, or an HD one without variants, is refused", () => {
  assert.throws(() => mergeMasters("<html>", HD_MASTER), /not a playlist/);
  assert.throws(() => mergeMasters(SD_MASTER, "#EXTM3U\n"), /no variants/);
});

test("ffprobe args and parsing", () => {
  assert.deepEqual(buildProbeArgs("s.mp4"), ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", "s.mp4"]);
  const probe = parseProbe({
    format: { duration: "62.500000" },
    streams: [
      { codec_type: "video", codec_name: "h264", width: 1920, height: 1080, avg_frame_rate: "30000/1001",
        side_data_list: [{ side_data_type: "Display Matrix", rotation: -90 }] },
      { codec_type: "audio", codec_name: "aac" },
    ],
  });
  assert.equal(probe.durationS, 62.5);
  assert.equal(probe.rotation, -90);
  assert.equal(probe.hasAudio, true);
  assert.equal(Math.round(probe.fps * 100), 2997);
  assert.throws(() => parseProbe({ format: {}, streams: [{ codec_type: "audio" }] }), /no video stream/);
  assert.throws(() => parseProbe({ format: {}, streams: [{ codec_type: "video", width: 2, height: 2 }] }), /no duration/);
  // Cover art in an audio file is not a video.
  assert.throws(
    () => parseProbe({ format: { duration: "3" }, streams: [{ codec_type: "video", disposition: { attached_pic: 1 } }] }),
    /no video stream/,
  );
});

test("the time limit follows the video's length, between 2 and 12 hours", async () => {
  const { JOB_TIMEOUT_MAX_MS, JOB_TIMEOUT_MS, jobTimeoutMs } = await import("../lib/limits.mjs");
  const hour = 60 * 60 * 1000;
  assert.equal(JOB_TIMEOUT_MS, 2 * hour);
  assert.equal(jobTimeoutMs(60), 2 * hour);
  assert.equal(jobTimeoutMs(NaN), 2 * hour);
  // The 3 hour upload that sat at 5%: 1 hour plus twice its length.
  assert.equal(jobTimeoutMs(10693.4), hour + 10693.4 * 2000);
  assert.equal(jobTimeoutMs(24 * 3600), JOB_TIMEOUT_MAX_MS);
});

test("a rung capped at 30 fps drops frames before it is scaled; the others keep the source rate", () => {
  const renditions = pickRenditions({ width: 1920, height: 1080, fps: 60 });
  const args = buildEncodeArgs({ input: "in.mp4", renditions, hasAudio: true });
  const graph = args[args.indexOf("-filter_complex") + 1].split(";");
  assert.equal(graph[1], "[s0]fps=30,scale=640:360:flags=bicubic,setsar=1,format=yuv420p[v0]");
  assert.equal(graph[2], "[s1]scale=1280:720:flags=bicubic,setsar=1,format=yuv420p[v1]");
  assert.equal(graph[3], "[s2]scale=1920:1080:flags=bicubic,setsar=1,format=yuv420p[v2]");
});
