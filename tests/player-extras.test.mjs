// Player extras: chapters, timestamps, double tap, the right-click menu and Stats for nerds.
import assert from "node:assert/strict";
import { test } from "node:test";
import { chapterAt, parseChapters, parseTimestamp, splitTimestamps } from "../lib/watch/chapters.ts";
import { bufferAhead, menuPosition, nerdRows, watchLink } from "../lib/watch/nerds.ts";
import { DOUBLE_TAP_MS, nextTap, tapSide, tapTotal } from "../lib/watch/taps.ts";

const DESCRIPTION = [
  "My video!",
  "",
  "Chapters:",
  "0:00 Intro",
  "1:05 - The setup",
  "[2:30] Big reveal",
  "3. 10:00 Outro",
  "",
  "Thanks for watching. Skip to 4:20 for the joke.",
].join("\n");

test("parseTimestamp: m:ss, mm:ss and h:mm:ss", () => {
  assert.equal(parseTimestamp("0:00"), 0);
  assert.equal(parseTimestamp("1:05"), 65);
  assert.equal(parseTimestamp("75:00"), 4500);
  assert.equal(parseTimestamp("1:02:05"), 3725);
  assert.equal(parseTimestamp(" 12:34 "), 754);
  for (const bad of ["1:60", "1:61:00", "1:2", "12", "a:bc", "1:02:03:04", ""]) assert.equal(parseTimestamp(bad), null, bad);
});

test("splitTimestamps keeps every character and only links real timestamps", () => {
  const text = "see 1:05 and 1:02:03, not 10:30am, 1.12:30, 12:345 or 3:61";
  const parts = splitTimestamps(text);
  assert.equal(parts.map((p) => p.text).join(""), text);
  assert.deepEqual(
    parts.filter((p) => p.seconds !== undefined),
    [{ text: "1:05", seconds: 65 }, { text: "1:02:03", seconds: 3723 }],
  );
  assert.deepEqual(splitTimestamps("0:00"), [{ text: "0:00", seconds: 0 }]);
  assert.deepEqual(splitTimestamps("(4:20)"), [{ text: "(" }, { text: "4:20", seconds: 260 }, { text: ")" }]);
  assert.deepEqual(splitTimestamps(""), []);
});

test("chapters: the 0:00 list, titles cleaned, a later sentence ignored", () => {
  assert.deepEqual(parseChapters(DESCRIPTION, 700), [
    { start: 0, end: 65, title: "Intro" },
    { start: 65, end: 150, title: "The setup" },
    { start: 150, end: 600, title: "Big reveal" },
    { start: 600, end: 700, title: "Outro" },
  ]);
  // Without a length the last chapter has no end.
  assert.equal(parseChapters(DESCRIPTION).at(-1).end, null);
  // Title after the time, a separator, or none at all.
  assert.deepEqual(
    parseChapters("Intro - 0:00\nMiddle | 0:30\n1:00", 120).map((c) => c.title),
    ["Intro", "Middle", "Chapter 3"],
  );
});

test("chapters: YouTube's 2020 rules or nothing", () => {
  assert.deepEqual(parseChapters("0:00 a\n1:00 b", 300), [], "fewer than 3");
  assert.deepEqual(parseChapters("0:05 a\n1:00 b\n2:00 c", 300), [], "does not start at 0:00");
  assert.deepEqual(parseChapters("0:00 a\n0:05 b\n1:00 c", 300), [], "a chapter under 10 s");
  assert.deepEqual(parseChapters("0:00 a\n2:00 b\n1:00 c", 300), [], "out of order");
  assert.deepEqual(parseChapters(DESCRIPTION, 605), [], "the last chapter would be 5 s");
  assert.deepEqual(parseChapters("", 300), []);
  assert.deepEqual(parseChapters("no times here", 300), []);
});

test("chapterAt finds the playing chapter", () => {
  const chapters = parseChapters(DESCRIPTION, 700);
  assert.equal(chapterAt(chapters, 0), 0);
  assert.equal(chapterAt(chapters, 64.9), 0);
  assert.equal(chapterAt(chapters, 65), 1);
  assert.equal(chapterAt(chapters, 9999), 3);
  assert.equal(chapterAt(chapters, -1), 0);
  assert.equal(chapterAt([], 5), -1);
});

test("double tap: halves, the time window and 10 more for each tap", () => {
  assert.equal(tapSide(10, 100), "back");
  assert.equal(tapSide(50, 100), "forward");
  assert.equal(tapSide(5, 0), "back");

  let r = nextTap(null, 1000, "forward");
  assert.equal(r.skip, 0, "the first tap may still be a single tap");
  r = nextTap(r.state, 1000 + DOUBLE_TAP_MS, "forward");
  assert.equal(r.skip, 10);
  assert.equal(tapTotal(r.state.count), 10);
  r = nextTap(r.state, 1000 + DOUBLE_TAP_MS + 200, "forward");
  assert.equal(r.skip, 10);
  assert.equal(tapTotal(r.state.count), 20);

  assert.equal(nextTap(r.state, r.state.at + 100, "back").skip, 0, "the other half starts over");
  assert.equal(nextTap(r.state, r.state.at + DOUBLE_TAP_MS + 1, "forward").skip, 0, "too slow starts over");
  assert.equal(nextTap(nextTap(null, 0, "back").state, 100, "back").skip, -10);
  assert.equal(tapTotal(1), 0);
});

test("right-click menu stays inside the player", () => {
  assert.deepEqual(menuPosition(10, 10, 854, 480), { left: 10, top: 10 });
  assert.deepEqual(menuPosition(850, 470, 854, 480), { left: 854 - 300 - 4, top: 480 - 176 - 4 });
  assert.deepEqual(menuPosition(-5, -5, 200, 100), { left: 4, top: 4 });
});

test("watchLink: the copied links", () => {
  assert.equal(watchLink("https://tube.example.test", "abc"), "https://tube.example.test/watch?v=abc");
  assert.equal(watchLink("https://tube.example.test/", "abc", 0.9), "https://tube.example.test/watch?v=abc");
  assert.equal(watchLink("https://tube.example.test", "abc", 90.7), "https://tube.example.test/watch?v=abc&t=90");
  assert.equal(watchLink("https://tube.example.test", "a b", NaN), "https://tube.example.test/watch?v=a%20b");
});

test("Stats for nerds rows", () => {
  const rows = new Map(
    nerdRows({
      videoId: "vid",
      viewport: { width: 853.6, height: 480, dpr: 2 },
      frames: { dropped: 3, total: 1200 },
      current: { width: 1280, height: 720, fps: 29.97 },
      optimal: { width: 1920, height: 1080, fps: 30 },
      volume: 0.5,
      muted: true,
      codecs: { video: "avc1.64001f", audio: "mp4a.40.2" },
      bandwidthBps: 12_345_678,
      bufferS: 12.345,
      rate: 1.5,
      quality: "Auto (720p)",
      engine: "hls.js 1.7.3",
    }),
  );
  assert.equal(rows.get("Video ID"), "vid");
  assert.equal(rows.get("Viewport / Frames"), "854x480*2.00 / 3 dropped of 1200");
  assert.equal(rows.get("Current / Optimal Res"), "1280x720@30 / 1920x1080@30");
  assert.equal(rows.get("Volume"), "50% (muted)");
  assert.equal(rows.get("Codecs"), "avc1.64001f / mp4a.40.2");
  assert.equal(rows.get("Connection Speed"), "12,346 Kbps");
  assert.equal(rows.get("Buffer Health"), "12.35 s");
  assert.equal(rows.get("Playback"), "1.5x, Auto (720p)");
  assert.equal(rows.get("Stream"), "hls.js 1.7.3");

  const safari = new Map(
    nerdRows({
      videoId: "vid",
      viewport: { width: 320, height: 180, dpr: 3 },
      frames: null,
      current: { width: 0, height: 0, fps: null },
      optimal: null,
      volume: 1,
      muted: false,
      codecs: { video: null, audio: null },
      bandwidthBps: null,
      bufferS: NaN,
      rate: 1,
      quality: "picked by Safari",
      engine: "Safari (native HLS)",
    }),
  );
  assert.equal(safari.get("Viewport / Frames"), "320x180*3.00 / not available");
  assert.equal(safari.get("Current / Optimal Res"), "unknown / unknown");
  assert.equal(safari.get("Codecs"), "unknown / unknown");
  assert.equal(safari.get("Connection Speed"), "not measured yet");
  assert.equal(safari.get("Buffer Health"), "0.00 s");
});

test("bufferAhead reads the range under the playhead", () => {
  const ranges = (list) => ({ length: list.length, start: (i) => list[i][0], end: (i) => list[i][1] });
  assert.equal(bufferAhead(ranges([[0, 10], [20, 40]]), 25), 15);
  assert.equal(bufferAhead(ranges([[0, 10]]), 4), 6);
  assert.equal(bufferAhead(ranges([[0, 10]]), 15), 0);
  assert.equal(bufferAhead(ranges([]), 0), 0);
});

test("end screen: nine videos from Up next, never the one that ended", async () => {
  const { END_SCREEN_COUNT, endScreenVideos, nextVideo } = await import("../lib/watch/endscreen.ts");
  const upNext = Array.from({ length: 12 }, (_, i) => ({ id: `v${i}` }));
  assert.equal(END_SCREEN_COUNT, 9);
  assert.deepEqual(endScreenVideos(upNext, "x").map((v) => v.id), ["v0", "v1", "v2", "v3", "v4", "v5", "v6", "v7", "v8"]);
  assert.deepEqual(endScreenVideos([{ id: "now" }, ...upNext], "now").length, 9);
  assert.ok(!endScreenVideos([{ id: "now" }, { id: "a" }], "now").some((v) => v.id === "now"));
  assert.deepEqual(endScreenVideos([], "now"), []);
  assert.equal(nextVideo([{ id: "now" }, { id: "a" }], "now").id, "a");
  assert.equal(nextVideo([{ id: "now" }], "now"), null);
});

test("end screen: countdown with autoplay on, the wall with it off", async () => {
  const { AUTOPLAY_COUNTDOWN_S, endChoice, secondsLeft } = await import("../lib/watch/endscreen.ts");
  assert.equal(endChoice(true, true, 9), "countdown");
  assert.equal(endChoice(false, true, 9), "wall");
  assert.equal(endChoice(true, false, 0), null, "nothing to play or show: the replay button");
  assert.equal(endChoice(false, false, 0), null);
  assert.equal(AUTOPLAY_COUNTDOWN_S, 8);
  assert.equal(secondsLeft(1000, 1000), 8);
  assert.equal(secondsLeft(1000, 1100), 8);
  assert.equal(secondsLeft(1000, 2000), 7);
  assert.equal(secondsLeft(1000, 8999), 1);
  assert.equal(secondsLeft(1000, 9000), 0);
  assert.equal(secondsLeft(1000, 99000), 0);
  assert.equal(secondsLeft(5000, 1000), 8, "a clock going back never adds time");
});

test("browsers without hls.js: the quality menu comes from the master playlist", async () => {
  const { parseVariants, qualityOptions, levelForSize, levelForSaved, AUTO } = await import("../lib/watch/quality.ts");
  const master = [
    "#EXTM3U",
    "#EXT-X-VERSION:7",
    '#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="English (auto-generated)",LANGUAGE="en",URI="captions/en.m3u8"',
    '#EXT-X-STREAM-INF:BANDWIDTH=990000,RESOLUTION=640x360,CODECS="avc1.64001e,mp4a.40.2",SUBTITLES="subs"',
    "360p/index.m3u8",
    '#EXT-X-STREAM-INF:BANDWIDTH=3100000,RESOLUTION=1280x720,CODECS="avc1.64001f,mp4a.40.2",SUBTITLES="subs"',
    "",
    "720p/index.m3u8",
    "#EXT-X-STREAM-INF:BANDWIDTH=5500000,RESOLUTION=1920x1080",
    "https://cdn.example.com/v/1080p/index.m3u8",
  ].join("\n");
  const variants = parseVariants(master, "https://site.example/api/media/v1/master.m3u8");
  assert.deepEqual(
    variants.map((v) => [v.height, v.bitrate, v.uri]),
    [
      [360, 990000, "https://site.example/api/media/v1/360p/index.m3u8"],
      [720, 3100000, "https://site.example/api/media/v1/720p/index.m3u8"],
      [1080, 5500000, "https://cdn.example.com/v/1080p/index.m3u8"],
    ],
  );
  const opts = qualityOptions(variants);
  assert.deepEqual(opts.map((o) => [o.label, o.level]), [["1080p", 2], ["720p", 1], ["360p", 0], ["Auto", AUTO]]);
  assert.equal(levelForSaved(opts, "720p"), 1);
  // On Auto, the picture's size tells which one is playing (short side for portrait).
  assert.equal(levelForSize(opts, 1280, 720), 1);
  assert.equal(levelForSize(opts, 720, 1280), 1);
  assert.equal(levelForSize(opts, 0, 0), AUTO);
  assert.equal(levelForSize(opts, 854, 480), AUTO);
  assert.deepEqual(parseVariants("#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\n", "https://x.example/m.m3u8"), []);
});
