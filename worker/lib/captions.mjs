// Auto-generated captions. After a video is ready (so nobody waits for them)
// the worker runs speech to text with whisper.cpp over its sound and adds the
// words as an HLS subtitle rendition next to the video:
//
//   hls/<video>/captions/<lang>.vtt    the captions, as WebVTT
//   hls/<video>/captions/<lang>.m3u8   a one segment subtitle playlist for it
//   hls/<video>/master.m3u8            uploaded again with EXT-X-MEDIA TYPE=SUBTITLES
//
// The player finds them in the master playlist, so the database does not
// change. Nothing here can fail the job: a video without captions is still a
// video, and the reason goes to the log.
import { access, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { MASTER_PLAYLIST } from "./ffmpeg.mjs";
import { CAPTION_CHUNK_S, CAPTION_LINE_CHARS, CAPTION_MAX_LINES, captionsTimeoutMs } from "./limits.mjs";
import { limitText, seconds } from "./log.mjs";
import { vttTime } from "./sprite.mjs";

export const CAPTIONS_DIR = "captions";
export const SUBTITLE_GROUP = "subs";

/** Two cues with the same words this close together are one cue. */
const SAME_TEXT_GAP_S = 2;
/** A cue whisper gave no length gets this long on screen. */
const MIN_CUE_S = 0.5;
/** A last piece of sound shorter than this is not worth sending to the model. */
const MIN_CHUNK_S = 1;
/** A WAV with less than a quarter second of 16 kHz 16 bit sound in it (and its header) is skipped. */
const MIN_WAV_BYTES = 44 + 16000 * 2 * 0.25;

const REPLACEMENT_CHAR = String.fromCharCode(0xfffd);
const CONTROL_CHARS = new RegExp(`[${String.fromCharCode(0)}-${String.fromCharCode(31)}]`, "g");

/**
 * ffmpeg: one piece of the sound, `lengthS` seconds from `startS`, as the
 * 16 kHz mono 16 bit WAV whisper.cpp reads.
 */
export function buildAudioArgs({ input, output, startS, lengthS }) {
  return [
    "-nostdin",
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-ss",
    startS.toFixed(3),
    "-i",
    input,
    "-t",
    lengthS.toFixed(3),
    "-map",
    "0:a:0",
    "-vn",
    "-ac",
    "1",
    "-ar",
    "16000",
    "-c:a",
    "pcm_s16le",
    output,
  ];
}

/** The pieces of a `durationS` long video's sound: [{ startS, lengthS }]. */
export function audioChunks(durationS, chunkS = CAPTION_CHUNK_S) {
  const out = [];
  if (!(durationS > 0)) return out;
  for (let startS = 0; startS < durationS; startS += chunkS) {
    const lengthS = Math.min(chunkS, durationS - startS);
    if (lengthS >= MIN_CHUNK_S || out.length === 0) out.push({ startS, lengthS });
  }
  return out;
}

/**
 * whisper-cli: the words of one WAV as JSON in `${outBase}.json`. language is
 * "auto" for the first piece with speech, then the language it found, so a
 * long video stays in one language. With a voice detection model, music and
 * silence are skipped instead of guessed at.
 */
export function buildWhisperArgs({ model, vadModel = null, audio, outBase, threads, language = "auto" }) {
  const args = ["-m", model, "-f", audio, "-l", language, "-t", String(threads), "-oj", "-of", outBase];
  if (vadModel) args.push("--vad", "-vm", vadModel);
  return args;
}

/**
 * Reads whisper-cli's JSON. It only escapes quotes and backslashes, so a tab
 * or line break in the words would make it invalid: those become spaces first.
 * @returns {{ language: string, segments: { startS: number, endS: number, text: string }[] }}
 */
export function parseWhisperJson(raw) {
  const data = JSON.parse(String(raw).replace(CONTROL_CHARS, " "));
  const lang = data?.result?.language;
  const list = Array.isArray(data?.transcription) ? data.transcription : [];
  const segments = [];
  for (const s of list) {
    const startS = Number(s?.offsets?.from) / 1000;
    const endS = Number(s?.offsets?.to) / 1000;
    if (!Number.isFinite(startS) || !Number.isFinite(endS) || typeof s?.text !== "string") continue;
    segments.push({ startS, endS, text: s.text });
  }
  return { language: typeof lang === "string" ? lang.trim().toLowerCase() : "", segments };
}

/** The words of one segment, tidied. Empty when there are no letters or digits in it. */
export function cleanText(text) {
  const t = String(text ?? "")
    .split(REPLACEMENT_CHAR)
    .join("")
    .replace(/\[\s*BLANK_AUDIO\s*\]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return /[\p{L}\p{N}]/u.test(t) ? t : "";
}

const length = (s) => Array.from(s).length;

/** Words into lines of at most `max` characters. A longer word (or a run of CJK text) is cut. */
export function wrapLines(text, max = CAPTION_LINE_CHARS) {
  const words = text.split(" ").flatMap((w) => {
    const chars = Array.from(w);
    if (chars.length <= max) return [w];
    const parts = [];
    for (let i = 0; i < chars.length; i += max) parts.push(chars.slice(i, i + max).join(""));
    return parts;
  });
  const lines = [];
  let line = "";
  for (const w of words) {
    if (!w) continue;
    if (!line) line = w;
    else if (length(line) + 1 + length(w) <= max) line += ` ${w}`;
    else {
      lines.push(line);
      line = w;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * One cue as it shows on screen: at most CAPTION_MAX_LINES lines. More words
 * than that become several cues, sharing the time by how much text each has.
 */
export function splitCue(cue, { max = CAPTION_LINE_CHARS, lines: maxLines = CAPTION_MAX_LINES } = {}) {
  const lines = wrapLines(cue.text, max);
  const groups = [];
  for (let i = 0; i < lines.length; i += maxLines) groups.push(lines.slice(i, i + maxLines));
  if (groups.length <= 1) return [{ ...cue, text: lines.join("\n") }];
  const sizes = groups.map((g) => g.reduce((n, l) => n + length(l), 0));
  const total = sizes.reduce((a, b) => a + b, 0);
  const span = cue.endS - cue.startS;
  const out = [];
  let t = cue.startS;
  groups.forEach((g, i) => {
    const endS = i === groups.length - 1 ? cue.endS : t + (span * sizes[i]) / total;
    out.push({ startS: t, endS, text: g.join("\n") });
    t = endS;
  });
  return out;
}

/**
 * Whisper's segments (already moved to the video's timeline) into the cues
 * of the caption file: tidied, in order, inside the video, without overlaps,
 * the same words said twice in a row merged, and wrapped for the screen.
 */
export function buildCues(segments, durationS) {
  const end = Number.isFinite(durationS) && durationS > 0 ? durationS : Infinity;
  const cues = [];
  for (const s of segments) {
    const text = cleanText(s.text);
    if (!text) continue;
    const startS = Math.max(0, s.startS);
    if (startS >= end) continue;
    const endS = Math.min(end, s.endS > startS ? s.endS : startS + MIN_CUE_S);
    cues.push({ startS, endS, text });
  }
  cues.sort((a, b) => a.startS - b.startS);

  const merged = [];
  for (const c of cues) {
    const prev = merged.at(-1);
    if (prev && prev.text.toLowerCase() === c.text.toLowerCase() && c.startS - prev.endS < SAME_TEXT_GAP_S) {
      prev.endS = Math.max(prev.endS, c.endS);
      continue;
    }
    merged.push({ ...c });
  }
  // A cue ends where the next one starts.
  for (let i = 0; i < merged.length - 1; i++) {
    if (merged[i].endS > merged[i + 1].startS) merged[i].endS = Math.max(merged[i].startS + 0.1, merged[i + 1].startS);
  }
  return merged.flatMap((c) => splitCue(c));
}

/** & < and > as WebVTT wants them in cue text. */
export function escapeCueText(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** The caption file. */
export function buildCaptionVtt(cues) {
  const body = cues.map((c) => `${vttTime(c.startS)} --> ${vttTime(c.endS)}\n${escapeCueText(c.text)}`).join("\n\n");
  return `WEBVTT\n\n${body}${body ? "\n" : ""}`;
}

/** An HLS subtitle playlist with the whole caption file as its one segment. */
export function subtitlePlaylist(durationS, vttName) {
  const d = Math.max(1, Number.isFinite(durationS) ? durationS : 1);
  return [
    "#EXTM3U",
    "#EXT-X-VERSION:3",
    `#EXT-X-TARGETDURATION:${Math.ceil(d)}`,
    "#EXT-X-MEDIA-SEQUENCE:0",
    "#EXT-X-PLAYLIST-TYPE:VOD",
    `#EXTINF:${d.toFixed(3)},`,
    vttName,
    "#EXT-X-ENDLIST",
    "",
  ].join("\n");
}

/** Whisper's language code as a file name and LANGUAGE tag ("en", "haw"), "und" when unknown. */
export function languageTag(code) {
  const c = String(code ?? "").trim().toLowerCase();
  // Whisper calls Javanese "jw"; everybody else calls it "jv".
  const tag = c === "jw" ? "jv" : c;
  return /^[a-z]{2,3}$/.test(tag) ? tag : "und";
}

/** "English", "Japanese", in English like the rest of the UI. */
export function languageName(tag) {
  if (tag === "und") return "Unknown language";
  try {
    const name = new Intl.DisplayNames(["en"], { type: "language" }).of(tag);
    if (name && name.toLowerCase() !== tag) return name;
  } catch {
    // Not a language Intl knows.
  }
  return tag.toUpperCase();
}

/** The subtitle track of auto-generated captions in a language. */
export function captionTrack(code) {
  const lang = languageTag(code);
  return { lang, name: `${languageName(lang)} (auto-generated)`.replace(/["\r\n]/g, "") };
}

/**
 * The master playlist with the captions in it: an EXT-X-MEDIA subtitle line
 * before the first variant and SUBTITLES="subs" on every variant. Captions
 * from an earlier run are replaced, not added twice. They are off until the
 * viewer turns them on (DEFAULT=NO, AUTOSELECT=NO).
 */
export function addSubtitles(master, { lang, name, uri }) {
  const media = `#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="${SUBTITLE_GROUP}",NAME="${name}",LANGUAGE="${lang}",DEFAULT=NO,AUTOSELECT=NO,FORCED=NO,URI="${uri}"`;
  const out = [];
  let placed = false;
  for (const line of master.split(/\r?\n/)) {
    if (/^#EXT-X-MEDIA:.*TYPE=SUBTITLES/.test(line)) continue;
    if (line.startsWith("#EXT-X-STREAM-INF:")) {
      if (!placed) out.push(media);
      placed = true;
      out.push(`${line.replace(/,SUBTITLES="[^"]*"/g, "")},SUBTITLES="${SUBTITLE_GROUP}"`);
      continue;
    }
    out.push(line);
  }
  if (!placed) throw new Error("the master playlist has no variants");
  return out.join("\n");
}

/**
 * At start: the captions settings when whisper-cli can really hear (it turns
 * 2 seconds of silence into JSON, once plain and once with voice detection),
 * otherwise null. That catches a missing program or model and a CPU the
 * program was not built for before any video depends on it. The log says
 * which it is.
 */
export async function checkCaptions(settings, { log, run, workDir = tmpdir(), exists = fileExists, now = () => Date.now() }) {
  if (!settings) {
    log("captions", {}, "off: CAPTIONS_MODEL is not set, or CAPTIONS is off");
    return null;
  }
  if (!(await exists(settings.model))) {
    log("captions", {}, `off: the speech model ${settings.model} is missing`);
    return null;
  }
  const started = now();
  await mkdir(workDir, { recursive: true });
  // job- so the loop's start up clean removes it if the worker dies right here.
  const dir = await mkdtemp(join(workDir, "job-captions-check-"));
  const audio = join(dir, "silence.wav");
  const hear = async (vadModel) => {
    const outBase = join(dir, vadModel ? "vad" : "plain");
    await run(settings.bin, buildWhisperArgs({ ...settings, vadModel, audio, outBase, language: "en" }), { onStdout: () => {} });
    parseWhisperJson(await readFile(`${outBase}.json`, "utf8"));
  };
  try {
    try {
      await run("ffmpeg", [...SILENCE_ARGS, audio]);
      await hear(null);
    } catch (err) {
      log("captions", {}, `off: ${settings.bin} could not hear a test sound (${err.message})`);
      return null;
    }
    let vadModel = settings.vadModel;
    if (vadModel && !(await exists(vadModel))) {
      log("captions", {}, `the voice detection model ${vadModel} is missing, so whisper hears everything`);
      vadModel = null;
    } else if (vadModel) {
      try {
        await hear(vadModel);
      } catch (err) {
        log("captions", {}, `voice detection does not work (${err.message}), so whisper hears everything`);
        vadModel = null;
      }
    }
    const models = [settings.model, vadModel].filter(Boolean).map((m) => basename(m)).join(" and ");
    log("captions", { threads: settings.threads }, `on with ${models}, checked in ${seconds(now() - started)}`);
    return { ...settings, vadModel };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/** ffmpeg: 2 seconds of 16 kHz mono silence, for the check at start. */
const SILENCE_ARGS = ["-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "anullsrc=r=16000:cl=mono", "-t", "2", "-c:a", "pcm_s16le"];

async function fileExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Makes the captions of a video that is ready and uploads them. Never throws.
 * `out` is the folder that was uploaded under `prefix`, with master.m3u8 in it.
 * @returns {Promise<"off" | "silent" | "none" | "done" | "failed">}
 */
export async function addCaptions({ input, dir, out, durationS, hasAudio, prefix, ids }, deps) {
  const { storage, log, config, run, stopSignal, now = () => Date.now() } = deps;
  const settings = config.captions;
  if (!settings) return "off";
  if (!hasAudio) {
    log("captions", ids, "the video has no sound, so no captions");
    return "silent";
  }
  const started = now();
  const limit = deps.captionsTimeoutMs ?? captionsTimeoutMs(durationS);
  const controller = new AbortController();
  const { signal } = controller;
  const timer = setTimeout(() => controller.abort(new Error(`took longer than ${limitText(limit)}`)), limit);
  const onStop = () => controller.abort(new Error("the worker was stopped"));
  if (stopSignal?.aborted) onStop();
  stopSignal?.addEventListener("abort", onStop, { once: true });
  try {
    const audioDir = join(dir, "captions-work");
    await mkdir(audioDir, { recursive: true });
    const chunks = audioChunks(durationS);
    let language = "auto";
    let detected = "";
    const segments = [];
    for (const [i, chunk] of chunks.entries()) {
      const audio = join(audioDir, `${i}.wav`);
      const outBase = join(audioDir, `${i}`);
      await run("ffmpeg", buildAudioArgs({ input, output: audio, ...chunk }), { signal });
      // A sound track that ends before the picture leaves the last pieces (nearly) empty.
      if ((await stat(audio)).size < MIN_WAV_BYTES) {
        await rm(audio, { force: true });
        continue;
      }
      // Whisper prints every line it hears on stdout: not needed, the JSON has them.
      await run(settings.bin, buildWhisperArgs({ ...settings, audio, outBase, language }), { signal, onStdout: () => {} });
      const result = parseWhisperJson(await readFile(`${outBase}.json`, "utf8"));
      await rm(audio, { force: true });
      // The language comes from the first piece where somebody speaks.
      if (!detected && result.segments.some((s) => cleanText(s.text))) {
        detected = result.language;
        if (languageTag(detected) !== "und") language = detected;
      }
      for (const s of result.segments) segments.push({ ...s, startS: s.startS + chunk.startS, endS: s.endS + chunk.startS });
      if (chunks.length > 1) log("captions", ids, `${i + 1} of ${chunks.length} pieces in ${seconds(now() - started)}`);
    }

    const cues = buildCues(segments, durationS);
    if (cues.length === 0) {
      log("captions", ids, `no speech found (${seconds(now() - started)}), so no captions`);
      return "none";
    }
    const track = captionTrack(detected);
    const vttName = `${track.lang}.vtt`;
    const playlistName = `${track.lang}.m3u8`;
    await mkdir(join(out, CAPTIONS_DIR), { recursive: true });
    await writeFile(join(out, CAPTIONS_DIR, vttName), buildCaptionVtt(cues));
    await writeFile(join(out, CAPTIONS_DIR, playlistName), subtitlePlaylist(durationS, vttName));
    const master = await readFile(join(out, MASTER_PLAYLIST), "utf8");
    await writeFile(join(out, MASTER_PLAYLIST), addSubtitles(master, { ...track, uri: `${CAPTIONS_DIR}/${playlistName}` }));

    // The caption files first and the master last, so it never names a file that is not there yet.
    for (const name of [vttName, playlistName]) {
      await storage.upload(`${prefix}/${CAPTIONS_DIR}/${name}`, join(out, CAPTIONS_DIR, name), signal);
    }
    await storage.upload(`${prefix}/${MASTER_PLAYLIST}`, join(out, MASTER_PLAYLIST), signal);
    log("captions", { ...ids, language: track.lang, cues: cues.length }, `${track.name} in ${seconds(now() - started)}`);
    return "done";
  } catch (caught) {
    const err = signal.aborted && signal.reason instanceof Error ? signal.reason : caught;
    log("captions", ids, `no captions: ${err instanceof Error ? err.message : String(err)}`);
    return "failed";
  } finally {
    clearTimeout(timer);
    stopSignal?.removeEventListener("abort", onStop);
  }
}
