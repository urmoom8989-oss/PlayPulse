// ffmpeg arguments and its -progress output. Pure functions, so the tests can
// snapshot the exact command line.
//
// Why fMP4 segments and not MPEG-TS: fMP4 (CMAF) has less overhead per
// segment, plays in hls.js and in Safari's native HLS, and the same files can
// be served as DASH later without encoding again. TS would only help very old
// players, which sloptube does not target.
//
// The encode runs with its working directory set to the job's output folder,
// so every output path here is relative and the arguments do not depend on
// where the temp folder is.
import { SEGMENT_SECONDS, THUMBNAIL_WIDTH, X264_PRESET } from "./limits.mjs";

export const MASTER_PLAYLIST = "master.m3u8";
/** The HD run's own master playlist (low quality first): merged into master.m3u8, never uploaded. */
export const HD_MASTER_PLAYLIST = "hd-master.m3u8";
export const SPRITE_IMAGE = "sprite.webp";
export const SPRITE_VTT = "sprite.vtt";

/** Thumbnail file names: thumb-1.webp is the default one. */
export function thumbnailName(i) {
  return `thumb-${i + 1}.webp`;
}

/** The playlist of one rendition, relative to the master playlist. */
export function renditionPlaylist(r) {
  return `${r.name}/index.m3u8`;
}

/**
 * One ffmpeg run that decodes the source once, splits the picture into every
 * rendition plus the sprite, and writes the HLS ladder and the sprite's frames.
 *
 * The sprite's frames go out one by one as PNGs to `spriteFrames` (a printf
 * pattern outside the output folder, like /work/job-x/sprite/%03d.png), and
 * buildSpriteArgs() tiles them into sprite.webp afterwards. ffmpeg holds back
 * every -progress line until all of its outputs have started, and a tiled
 * sprite only starts once its last frame is in, at the end of the video: with
 * the tile inside this run, a long upload sat at 5% until the encode was done.
 * @param {{
 *   input: string,
 *   renditions: { name: string, width: number, height: number, videoKbps: number, audioKbps: number, fps?: number }[],
 *   hasAudio: boolean,
 *   sprite?: { interval: number, count: number, columns: number, rows: number, width: number, height: number } | null,
 *   spriteFrames?: string | null,
 *   segmentSeconds?: number,
 *   preset?: string,
 *   masterName?: string,
 * }} opts
 */
export function buildEncodeArgs({
  input,
  renditions,
  hasAudio,
  sprite = null,
  spriteFrames = null,
  segmentSeconds = SEGMENT_SECONDS,
  preset = X264_PRESET,
  masterName = MASTER_PLAYLIST,
}) {
  if (!renditions.length) throw new Error("no renditions");
  if (sprite && !spriteFrames) throw new Error("a sprite needs spriteFrames");
  const outs = renditions.map((_, i) => `[s${i}]`);
  if (sprite) outs.push("[sp]");

  const graph = [`[0:v]split=${outs.length}${outs.join("")}`];
  renditions.forEach((r, i) => {
    // A rung with `fps` (below 720p from a faster source) drops to that frame rate first.
    const fps = r.fps ? `fps=${r.fps},` : "";
    graph.push(`[s${i}]${fps}scale=${r.width}:${r.height}:flags=bicubic,setsar=1,format=yuv420p[v${i}]`);
  });
  if (sprite) {
    graph.push(
      `[sp]fps=1/${sprite.interval},` +
        `scale=${sprite.width}:${sprite.height}:force_original_aspect_ratio=decrease,` +
        `pad=${sprite.width}:${sprite.height}:(ow-iw)/2:(oh-ih)/2,setsar=1[spr]`,
    );
  }

  const args = ["-hide_banner", "-nostdin", "-y", "-loglevel", "error", "-nostats", "-progress", "pipe:1"];
  args.push("-i", input, "-filter_complex", graph.join(";"));

  renditions.forEach((_, i) => {
    args.push("-map", `[v${i}]`);
    if (hasAudio) args.push("-map", "0:a:0");
  });

  args.push(
    "-c:v", "libx264",
    "-preset", preset,
    "-profile:v", "high",
    "-sc_threshold", "0",
    "-force_key_frames", `expr:gte(t,n_forced*${segmentSeconds})`,
  );
  renditions.forEach((r, i) => {
    args.push(
      `-b:v:${i}`, `${r.videoKbps}k`,
      `-maxrate:v:${i}`, `${Math.round(r.videoKbps * 1.07)}k`,
      `-bufsize:v:${i}`, `${Math.round(r.videoKbps * 1.5)}k`,
    );
  });
  if (hasAudio) {
    args.push("-c:a", "aac", "-ac", "2", "-ar", "48000");
    renditions.forEach((r, i) => args.push(`-b:a:${i}`, `${r.audioKbps}k`));
  }

  const streamMap = renditions
    .map((r, i) => (hasAudio ? `v:${i},a:${i},name:${r.name}` : `v:${i},name:${r.name}`))
    .join(" ");
  args.push(
    "-f", "hls",
    "-hls_time", String(segmentSeconds),
    "-hls_playlist_type", "vod",
    "-hls_segment_type", "fmp4",
    "-hls_flags", "independent_segments",
    "-hls_fmp4_init_filename", "init.mp4",
    "-hls_segment_filename", "%v/seg_%05d.m4s",
    "-master_pl_name", masterName,
    "-var_stream_map", streamMap,
    "%v/index.m3u8",
  );

  if (sprite) {
    args.push("-map", "[spr]", "-frames:v", String(sprite.count), "-c:v", "png", "-f", "image2", spriteFrames);
  }
  return args;
}

/**
 * Low quality first: the master playlist with the HD run's renditions added
 * after the low ones. Lines of the low master stay as they are (its header,
 * and a subtitle group if captions were added); an HD variant gets the same
 * SUBTITLES group, and one already listed is not listed twice.
 */
export function mergeMasters(sdMaster, hdMaster) {
  const sd = String(sdMaster).replace(/\r/g, "").split("\n").filter((l) => l.trim() !== "");
  if (!sd.length || !sd[0].startsWith("#EXTM3U")) throw new Error("the low quality master playlist is not a playlist");
  const subs = /SUBTITLES="([^"]+)"/.exec(sd.join("\n"))?.[1] ?? null;
  const listed = new Set(sd.filter((l) => !l.startsWith("#")));
  const hd = String(hdMaster).replace(/\r/g, "").split("\n");
  const added = [];
  let variants = 0;
  for (let i = 0; i < hd.length; i++) {
    if (!hd[i].startsWith("#EXT-X-STREAM-INF:")) continue;
    let j = i + 1;
    while (j < hd.length && (hd[j].trim() === "" || hd[j].startsWith("#"))) j++;
    const uri = hd[j]?.trim();
    if (!uri) continue;
    variants++;
    // Already there (a retry after the merged master went up): left as it is.
    if (listed.has(uri)) continue;
    const inf = subs && !/SUBTITLES=/.test(hd[i]) ? `${hd[i]},SUBTITLES="${subs}"` : hd[i];
    added.push(inf, uri);
    listed.add(uri);
    i = j;
  }
  if (!variants) throw new Error("the HD master playlist has no variants");
  return `${[...sd, ...added].join("\n")}\n`;
}

/**
 * Tiles the sprite's frames from the encode (see buildEncodeArgs) into one
 * WebP image, `columns` frames a row. A short last row is left empty, which
 * the WebVTT file never points at.
 * @param {{ frames: string, plan: { columns: number, rows: number }, output: string }} opts
 */
export function buildSpriteArgs({ frames, plan, output }) {
  return [
    "-hide_banner", "-nostdin", "-y", "-loglevel", "error",
    "-framerate", "1", "-start_number", "1", "-i", frames,
    "-vf", `tile=${plan.columns}x${plan.rows}`,
    "-frames:v", "1",
    "-c:v", "libwebp", "-quality", "70",
    output,
  ];
}

/** One thumbnail: a fast seek, one frame, 1280 wide (never wider than the source), WebP. */
export function buildThumbnailArgs({ input, atSeconds, output, width = THUMBNAIL_WIDTH }) {
  return [
    "-hide_banner", "-nostdin", "-y", "-loglevel", "error",
    "-ss", atSeconds.toFixed(3),
    "-i", input,
    "-frames:v", "1",
    "-vf", `scale='min(${width},iw)':-2,setsar=1`,
    "-c:v", "libwebp",
    "-quality", "80",
    output,
  ];
}

/**
 * Turns ffmpeg's `-progress pipe:1` stream into seconds encoded so far.
 * Feed it chunks as they arrive; it calls onTime(seconds) for each update
 * and onEnd() when ffmpeg writes progress=end.
 */
export function createProgressParser(onTime, onEnd = () => {}) {
  let carry = "";
  return (chunk) => {
    carry += String(chunk);
    const lines = carry.split("\n");
    carry = lines.pop() ?? "";
    for (const raw of lines) {
      const line = raw.trim();
      const eq = line.indexOf("=");
      if (eq < 0) continue;
      const key = line.slice(0, eq);
      const value = line.slice(eq + 1);
      // out_time_ms is in microseconds too (an old ffmpeg naming mistake).
      if (key === "out_time_us" || key === "out_time_ms") {
        const us = Number(value);
        if (Number.isFinite(us) && us >= 0) onTime(us / 1e6);
      } else if (key === "progress" && value === "end") {
        onEnd();
      }
    }
  };
}

/** The share of the job a step covers, so the studio bar moves once from 0 to 100. */
export const PROGRESS_STEPS = {
  downloaded: 3,
  encodeStart: 5,
  encodeEnd: 90,
  thumbnails: 92,
  uploadEnd: 99,
};

/**
 * Low quality first: the quick low run up to 30% (the video plays from
 * there), then the HD run and its upload. Owners see the HD share as
 * "HD processing".
 */
export const SPLIT_STEPS = {
  downloaded: 3,
  encodeStart: 5,
  encodeEnd: 25,
  thumbnails: 27,
  uploadEnd: 30,
  hdStart: 30,
  hdEnd: 92,
  hdUploadEnd: 99,
};

/** Whole percent for `seconds` encoded out of `durationS`, between `from` and `to` (the encode share by default). */
export function encodePercent(seconds, durationS, from = PROGRESS_STEPS.encodeStart, to = PROGRESS_STEPS.encodeEnd) {
  if (!(durationS > 0)) return from;
  const share = Math.min(1, Math.max(0, seconds / durationS));
  return Math.floor(from + share * (to - from));
}
