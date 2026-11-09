// Which renditions a source gets. Pure functions, no imports but the limits.
import { FULL_FPS_FROM, HIGH_FPS, LADDER, LOW_RUNG_FPS, NATIVE_RUNG_MIN_RATIO } from "./limits.mjs";

/** The nearest even number, at least 2. H.264 with yuv420p needs even sizes. */
export function even(n) {
  return Math.max(2, 2 * Math.round(n / 2));
}

/** The even number at or below n, at least 2. Used where rounding up would upscale. */
export function evenDown(n) {
  const f = Math.floor(n);
  return Math.max(2, f - (f % 2));
}

/** The size people see: width and height swap when the video is rotated by 90 or 270 degrees. */
export function displaySize({ width, height, rotation = 0 }) {
  const quarter = Math.round(Math.abs(rotation) / 90) % 2 === 1;
  return quarter ? { width: height, height: width } : { width, height };
}

/**
 * The renditions for a source, smallest first.
 *   - only rungs whose short side fits in the source (never upscale)
 *   - a source smaller than 360p gets one rendition at its own size
 *   - a source well between two rungs (for example 1280x900) also gets one at
 *     its own size, so it does not lose detail
 *   - every width and height is even
 *   - below 720p a source faster than 30 fps is capped at 30 fps (`fps` on the
 *     rung); 720p and up keep the source's frame rate and, above 30 fps, get
 *     1.5 times the bitrate
 * @param {{ width: number, height: number, rotation?: number, fps?: number }} source
 */
export function pickRenditions(source) {
  const { width, height } = displaySize(source);
  if (!(width > 0 && height > 0)) throw new Error("source has no size");
  const portrait = height > width;
  const short = Math.min(width, height);
  const long = Math.max(width, height);
  const highFps = (source.fps ?? 30) > HIGH_FPS;

  const size = (shortSide) => {
    const longSide = Math.min(even((long * shortSide) / short), evenDown(long));
    return portrait ? { width: shortSide, height: longSide } : { width: longSide, height: shortSide };
  };
  const rung = (name, shortSide, videoKbps, audioKbps) => {
    const capped = highFps && shortSide < FULL_FPS_FROM;
    return {
      name,
      ...size(shortSide),
      videoKbps: Math.round(videoKbps * (highFps && !capped ? 1.5 : 1)),
      audioKbps,
      ...(capped ? { fps: LOW_RUNG_FPS } : {}),
    };
  };

  const fits = LADDER.filter((r) => r.height <= short);
  if (fits.length === 0) {
    const s = evenDown(short);
    const base = LADDER[0];
    const kbps = Math.max(200, Math.round(base.videoKbps * ((s * s) / (base.height * base.height))));
    return [rung(`${s}p`, s, kbps, base.audioKbps)];
  }

  const out = fits.map((r) => rung(r.name, r.height, r.videoKbps, r.audioKbps));
  const top = fits[fits.length - 1];
  const next = LADDER[fits.length];
  if (next && short >= top.height * NATIVE_RUNG_MIN_RATIO) {
    const s = evenDown(short);
    const scaled = Math.round(top.videoKbps * ((s * s) / (top.height * top.height)));
    out.push(rung(`${s}p`, s, Math.min(scaled, next.videoKbps), next.audioKbps));
  }
  return out;
}
