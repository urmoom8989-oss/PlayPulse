// Auto-generated captions: whisper.cpp's JSON in, a WebVTT file and an HLS
// subtitle rendition out. The real ffmpeg cuts the sound when it is installed.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  addSubtitles,
  audioChunks,
  buildAudioArgs,
  buildCaptionVtt,
  buildCues,
  buildWhisperArgs,
  captionTrack,
  checkCaptions,
  cleanText,
  languageTag,
  parseWhisperJson,
  splitCue,
  subtitlePlaylist,
  wrapLines,
} from "../lib/captions.mjs";
import { captionsTimeoutMs } from "../lib/limits.mjs";
import { run } from "../lib/run.mjs";
import { whisperJson } from "./whisper-fake.mjs";

test("captions: the sound is cut into 15 minute pieces", () => {
  assert.deepEqual(audioChunks(2000), [
    { startS: 0, lengthS: 900 },
    { startS: 900, lengthS: 900 },
    { startS: 1800, lengthS: 200 },
  ]);
  // A last piece under a second is not worth a run.
  assert.deepEqual(audioChunks(900.4), [{ startS: 0, lengthS: 900 }]);
  // A very short video still gets its one piece.
  assert.deepEqual(audioChunks(0.6), [{ startS: 0, lengthS: 0.6 }]);
  assert.deepEqual(audioChunks(0), []);
  assert.deepEqual(audioChunks(Number.NaN), []);
});

test("captions: ffmpeg and whisper-cli arguments", () => {
  assert.deepEqual(buildAudioArgs({ input: "/w/source.mp4", output: "/w/c/1.wav", startS: 900, lengthS: 412.25 }), [
    "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
    "-ss", "900.000", "-i", "/w/source.mp4", "-t", "412.250",
    "-map", "0:a:0", "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", "/w/c/1.wav",
  ]);
  assert.deepEqual(buildWhisperArgs({ model: "/m/speech.bin", audio: "/w/0.wav", outBase: "/w/0", threads: 4 }), [
    "-m", "/m/speech.bin", "-f", "/w/0.wav", "-l", "auto", "-t", "4", "-oj", "-of", "/w/0",
  ]);
  assert.deepEqual(
    buildWhisperArgs({ model: "/m/speech.bin", vadModel: "/m/vad.bin", audio: "/w/1.wav", outBase: "/w/1", threads: 2, language: "de" }).slice(4),
    ["-l", "de", "-t", "2", "-oj", "-of", "/w/1", "--vad", "-vm", "/m/vad.bin"],
  );
});

test("captions: whisper's JSON, even with a tab or a line break in the words", () => {
  const raw = whisperJson("EN", [
    [0, 2500, " Hello there."],
    [2500, 6000, " General\tKenobi,\nyou are a bold one."],
  ]);
  const { language, segments } = parseWhisperJson(raw);
  assert.equal(language, "en");
  assert.deepEqual(segments, [
    { startS: 0, endS: 2.5, text: " Hello there." },
    { startS: 2.5, endS: 6, text: " General Kenobi, you are a bold one." },
  ]);
  assert.deepEqual(parseWhisperJson('{"transcription": [{"text": "x"}]}'), { language: "", segments: [] });
  assert.throws(() => parseWhisperJson("not json"));
});

test("captions: the words are tidied", () => {
  assert.equal(cleanText("  Hello   there. "), "Hello there.");
  assert.equal(cleanText(" [BLANK_AUDIO]"), "");
  assert.equal(cleanText(" ... "), "");
  assert.equal(cleanText(" [Music]"), "[Music]");
  assert.equal(cleanText(`caf${String.fromCharCode(0xfffd)}e`), "cafe");
  assert.equal(cleanText("こんにちは"), "こんにちは");
  assert.equal(cleanText(undefined), "");
});

test("captions: long lines wrap at 42 characters and a cue holds at most 2 lines", () => {
  const text = "the quick brown fox jumps over the lazy dog and then it runs all the way back home again before dinner";
  const lines = wrapLines(text);
  assert.ok(lines.every((l) => Array.from(l).length <= 42), lines.join("|"));
  assert.equal(lines.join(" "), text);

  // A run of text with no spaces (Japanese, say) is cut.
  const cjk = "あ".repeat(100);
  assert.deepEqual(wrapLines(cjk).map((l) => Array.from(l).length), [42, 42, 16]);

  const cues = splitCue({ startS: 10, endS: 20, text });
  assert.equal(cues.length, 2);
  assert.equal(cues[0].startS, 10);
  assert.equal(cues[1].endS, 20);
  assert.equal(cues[0].endS, cues[1].startS);
  // 81 of the 100 characters are in the first cue, so it gets 81% of the time.
  assert.ok(Math.abs(cues[0].endS - 18.1) < 1e-9, `split at ${cues[0].endS}`);
  assert.equal(cues[0].text.split("\n").length, 2);

  assert.deepEqual(splitCue({ startS: 1, endS: 2, text: "short one" }), [{ startS: 1, endS: 2, text: "short one" }]);
});

test("captions: cues are in order, inside the video and never overlap", () => {
  const cues = buildCues(
    [
      { startS: 5, endS: 9, text: " second" },
      { startS: 0, endS: 6, text: " first" },
      { startS: 9.5, endS: 10, text: " [BLANK_AUDIO]" },
      { startS: 11, endS: 11, text: " no length" },
      { startS: 12, endS: 13, text: " again" },
      { startS: 13.5, endS: 14, text: " Again" },
      { startS: 29, endS: 31, text: " past the end" },
      { startS: 31, endS: 32, text: " after the end" },
    ],
    30,
  );
  assert.deepEqual(cues, [
    { startS: 0, endS: 5, text: "first" },
    { startS: 5, endS: 9, text: "second" },
    { startS: 11, endS: 11.5, text: "no length" },
    { startS: 12, endS: 14, text: "again" },
    { startS: 29, endS: 30, text: "past the end" },
  ]);
  assert.deepEqual(buildCues([], 10), []);
});

test("captions: the WebVTT file", () => {
  const vtt = buildCaptionVtt([
    { startS: 0, endS: 2.5, text: "Tom & Jerry" },
    { startS: 83.5, endS: 3725.25, text: "a <b> tag -->\nsecond line" },
  ]);
  assert.equal(
    vtt,
    "WEBVTT\n\n00:00:00.000 --> 00:00:02.500\nTom &amp; Jerry\n\n00:01:23.500 --> 01:02:05.250\na &lt;b&gt; tag --&gt;\nsecond line\n",
  );
  assert.equal(buildCaptionVtt([]), "WEBVTT\n\n");
});

test("captions: the subtitle playlist is one segment, the whole file", () => {
  assert.equal(
    subtitlePlaylist(83.25, "en.vtt"),
    "#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:84\n#EXT-X-MEDIA-SEQUENCE:0\n#EXT-X-PLAYLIST-TYPE:VOD\n#EXTINF:83.250,\nen.vtt\n#EXT-X-ENDLIST\n",
  );
});

const MASTER = [
  "#EXTM3U",
  "#EXT-X-VERSION:7",
  "#EXT-X-STREAM-INF:BANDWIDTH=1100000,RESOLUTION=640x360,CODECS=\"avc1.64001e,mp4a.40.2\"",
  "360p/index.m3u8",
  "",
  "#EXT-X-STREAM-INF:BANDWIDTH=3300000,RESOLUTION=1280x720,CODECS=\"avc1.64001f,mp4a.40.2\"",
  "720p/index.m3u8",
  "",
].join("\n");

test("captions: the master playlist gets a subtitle group on every variant", () => {
  const track = { ...captionTrack("en"), uri: "captions/en.m3u8" };
  const once = addSubtitles(MASTER, track);
  assert.equal(
    once,
    [
      "#EXTM3U",
      "#EXT-X-VERSION:7",
      '#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="English (auto-generated)",LANGUAGE="en",DEFAULT=NO,AUTOSELECT=NO,FORCED=NO,URI="captions/en.m3u8"',
      '#EXT-X-STREAM-INF:BANDWIDTH=1100000,RESOLUTION=640x360,CODECS="avc1.64001e,mp4a.40.2",SUBTITLES="subs"',
      "360p/index.m3u8",
      "",
      '#EXT-X-STREAM-INF:BANDWIDTH=3300000,RESOLUTION=1280x720,CODECS="avc1.64001f,mp4a.40.2",SUBTITLES="subs"',
      "720p/index.m3u8",
      "",
    ].join("\n"),
  );
  // Running it again replaces the captions instead of adding them twice.
  const again = addSubtitles(once, { ...captionTrack("de"), uri: "captions/de.m3u8" });
  assert.equal(again.match(/TYPE=SUBTITLES/g).length, 1);
  assert.match(again, /NAME="German \(auto-generated\)",LANGUAGE="de"/);
  assert.equal(again.match(/SUBTITLES="subs"/g).length, 2);
  assert.throws(() => addSubtitles("#EXTM3U\n", track), /no variants/);
});

test("captions: language names and tags", () => {
  assert.deepEqual(captionTrack("en"), { lang: "en", name: "English (auto-generated)" });
  assert.deepEqual(captionTrack("ja"), { lang: "ja", name: "Japanese (auto-generated)" });
  assert.deepEqual(captionTrack("jw"), { lang: "jv", name: "Javanese (auto-generated)" });
  assert.deepEqual(captionTrack("haw"), { lang: "haw", name: "Hawaiian (auto-generated)" });
  assert.deepEqual(captionTrack(""), { lang: "und", name: "Unknown language (auto-generated)" });
  assert.equal(languageTag("../x"), "und");
  assert.equal(languageTag("EN"), "en");
});

test("captions: speech to text may take as long as the video, from 15 minutes to 6 hours", () => {
  assert.equal(captionsTimeoutMs(60), 15 * 60 * 1000);
  assert.equal(captionsTimeoutMs(3600), 60 * 60 * 1000);
  assert.equal(captionsTimeoutMs(24 * 3600), 6 * 60 * 60 * 1000);
  assert.equal(captionsTimeoutMs(Number.NaN), 15 * 60 * 1000);
});

test("captions: on at start only when whisper-cli hears the test sound", async () => {
  const workDir = await mkdtemp(join(tmpdir(), "sloptube-captions-check-"));
  const settings = { bin: "whisper-cli", model: "/m/speech.bin", vadModel: "/m/vad.bin", threads: 4 };
  const lines = [];
  const log = (step, fields, text) => lines.push(`${step} ${text}`);
  const there = (...paths) => async (p) => paths.includes(p);
  /** ffmpeg writes the silence; whisper writes its JSON, or throws for the runs `breaks` picks. */
  const fake = (breaks = () => false) => {
    const runs = [];
    const fn = async (cmd, args) => {
      runs.push({ cmd, args });
      if (cmd === "ffmpeg") return writeFile(args.at(-1), "RIFF");
      if (breaks(args)) throw new Error("whisper-cli was killed by SIGILL");
      await writeFile(`${args[args.indexOf("-of") + 1]}.json`, whisperJson("en", []));
      return "";
    };
    fn.runs = runs;
    return fn;
  };
  try {
    assert.equal(await checkCaptions(null, { log, run: fake(), workDir }), null);
    assert.match(lines.at(-1), /off: CAPTIONS_MODEL is not set/);

    assert.equal(await checkCaptions(settings, { log, run: fake(), workDir, exists: there() }), null);
    assert.match(lines.at(-1), /speech model \/m\/speech.bin is missing/);

    const broken = fake(() => true);
    assert.equal(await checkCaptions(settings, { log, run: broken, workDir, exists: there("/m/speech.bin") }), null);
    assert.match(lines.at(-1), /off: whisper-cli could not hear a test sound \(whisper-cli was killed by SIGILL\)/);

    // Without the voice detection model: on, hearing everything.
    assert.deepEqual(await checkCaptions(settings, { log, run: fake(), workDir, exists: there("/m/speech.bin") }), { ...settings, vadModel: null });
    assert.match(lines.at(-2), /voice detection model \/m\/vad.bin is missing/);
    assert.match(lines.at(-1), /on with speech.bin, checked in/);

    // Voice detection that breaks is left out.
    const noVad = fake((args) => args.includes("--vad"));
    assert.deepEqual(await checkCaptions(settings, { log, run: noVad, workDir, exists: there("/m/speech.bin", "/m/vad.bin") }), { ...settings, vadModel: null });
    assert.match(lines.at(-2), /voice detection does not work/);

    // Both work: one plain run and one with voice detection, in English, on the 2 s of silence.
    const good = fake();
    assert.deepEqual(await checkCaptions(settings, { log, run: good, workDir, exists: there("/m/speech.bin", "/m/vad.bin") }), settings);
    assert.match(lines.at(-1), /on with speech.bin and vad.bin, checked in/);
    assert.deepEqual(good.runs.map((r) => r.cmd), ["ffmpeg", "whisper-cli", "whisper-cli"]);
    assert.ok(good.runs[0].args.includes("anullsrc=r=16000:cl=mono"));
    assert.equal(good.runs[1].args[good.runs[1].args.indexOf("-l") + 1], "en");
    assert.ok(!good.runs[1].args.includes("--vad") && good.runs[2].args.includes("--vad"));

    // The check leaves nothing behind.
    assert.deepEqual(await readdir(workDir), []);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
});

// In the encoder image (docker exec sloptube-encoder node --test test/) this
// runs the real whisper-cli and models the image sets in CAPTIONS_MODEL.
const realModel = process.env.CAPTIONS_MODEL?.trim();
const realBin = process.env.WHISPER_BIN?.trim() || "whisper-cli";
const hasWhisper = Boolean(realModel && existsSync(realModel)) && spawnSync(realBin, ["--help"], { stdio: "ignore" }).status === 0;

test(
  "captions: the real whisper-cli hears the test sound",
  { skip: hasWhisper ? false : "whisper-cli or its model is not here (the encoder image has both)", timeout: 120000 },
  async () => {
    const workDir = await mkdtemp(join(tmpdir(), "sloptube-captions-real-"));
    const lines = [];
    try {
      const settings = { bin: realBin, model: realModel, vadModel: process.env.CAPTIONS_VAD_MODEL?.trim() || null, threads: 2 };
      const result = await checkCaptions(settings, { log: (step, f, text) => lines.push(text), run, workDir });
      assert.ok(result, lines.join("\n"));
      assert.equal(result.vadModel, settings.vadModel, lines.join("\n"));
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  },
);

const hasFfmpeg = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0;

/** The format and length of a WAV file, read from its chunks. */
function readWav(buf) {
  assert.equal(buf.toString("ascii", 0, 4), "RIFF");
  assert.equal(buf.toString("ascii", 8, 12), "WAVE");
  const out = {};
  for (let at = 12; at + 8 <= buf.length; ) {
    const id = buf.toString("ascii", at, at + 4);
    const size = buf.readUInt32LE(at + 4);
    if (id === "fmt ") {
      out.format = buf.readUInt16LE(at + 8);
      out.channels = buf.readUInt16LE(at + 10);
      out.rate = buf.readUInt32LE(at + 12);
      out.bits = buf.readUInt16LE(at + 22);
    }
    if (id === "data") out.dataBytes = Math.min(size, buf.length - at - 8);
    at += 8 + size + (size % 2);
  }
  return out;
}

test("captions: ffmpeg cuts a piece of the sound as 16 kHz mono WAV", { skip: hasFfmpeg ? false : "ffmpeg is not installed", timeout: 60000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "sloptube-captions-audio-"));
  try {
    const input = join(dir, "source.mp4");
    await run("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", "testsrc=size=320x180:rate=30:duration=3",
      "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=3",
      "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-ac", "2", "-c:a", "aac", "-shortest", input,
    ]);
    const output = join(dir, "1.wav");
    await run("ffmpeg", buildAudioArgs({ input, output, startS: 1, lengthS: 1.5 }));
    const wav = readWav(await readFile(output));
    assert.deepEqual({ format: wav.format, channels: wav.channels, rate: wav.rate, bits: wav.bits }, { format: 1, channels: 1, rate: 16000, bits: 16 });
    const seconds = wav.dataBytes / (16000 * 2);
    assert.ok(Math.abs(seconds - 1.5) < 0.05, `${seconds} s of sound`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
