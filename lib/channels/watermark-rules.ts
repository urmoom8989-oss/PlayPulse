// The channel watermark (044_watermarks.sql): the rules the studio, the
// player and the tests share. No imports, so Node can load it directly.

export type WatermarkShow = "entire" | "end" | "custom";

export type Watermark = { url: string; show: WatermarkShow; startS: number };

/** What the player needs: the watermark and whose it is. */
export type PlayerWatermark = Watermark & { channelId: string; channelName: string; channelHandle: string };

/** The picture is made square, this many pixels a side. */
export const WATERMARK_SIZE = 150;
/** "End of video" shows it for the last this many seconds. */
export const WATERMARK_END_S = 15;
/** The picked file, before it is made small. */
export const WATERMARK_FILE_MAX = 5 * 1024 * 1024;
export const WATERMARK_TYPES = ["image/png", "image/jpeg", "image/webp"];

export const WATERMARK_SHOWS: { value: WatermarkShow; label: string; hint: string }[] = [
  { value: "end", label: "End of video", hint: "The last 15 seconds" },
  { value: "custom", label: "Custom start time", hint: "From the time you pick to the end" },
  { value: "entire", label: "Entire video", hint: "From the start" },
];

export function isWatermarkShow(v: unknown): v is WatermarkShow {
  return v === "entire" || v === "end" || v === "custom";
}

/** Whether the watermark is on screen at `time` seconds of a `duration` long video. */
export function watermarkShown(w: Pick<Watermark, "show" | "startS">, time: number, duration: number): boolean {
  if (w.show === "entire") return true;
  if (w.show === "custom") return time >= w.startS;
  // End of video: only once the length is known.
  return duration > 0 && time >= Math.max(0, duration - WATERMARK_END_S);
}

/** What is wrong with a picked file, or null. */
export function watermarkFileProblem(file: { type: string; size: number }): string | null {
  if (!WATERMARK_TYPES.includes(file.type)) return "Pick a PNG, JPG or WebP picture.";
  if (file.size > WATERMARK_FILE_MAX) return "Pick a picture of up to 5 MB.";
  return null;
}

/** The square a picture of w x h fits in, centered, with see-through edges: { dx, dy, dw, dh }. */
export function watermarkFit(w: number, h: number, size = WATERMARK_SIZE): { dx: number; dy: number; dw: number; dh: number } {
  if (w <= 0 || h <= 0) return { dx: 0, dy: 0, dw: size, dh: size };
  const scale = Math.min(size / w, size / h);
  const dw = Math.max(1, Math.round(w * scale));
  const dh = Math.max(1, Math.round(h * scale));
  return { dx: Math.round((size - dw) / 2), dy: Math.round((size - dh) / 2), dw, dh };
}

/** A channels row's watermark columns, or null when there is none. */
export function readWatermark(r: { watermark_url?: unknown; watermark_show?: unknown; watermark_start_s?: unknown } | null | undefined): Watermark | null {
  if (!r || typeof r.watermark_url !== "string" || !r.watermark_url.startsWith("https://")) return null;
  const startS = Number(r.watermark_start_s);
  return {
    url: r.watermark_url,
    show: isWatermarkShow(r.watermark_show) ? r.watermark_show : "entire",
    startS: Number.isFinite(startS) && startS > 0 ? Math.floor(startS) : 0,
  };
}

/** set_channel_watermark() errors in words. */
export function watermarkErrorText(code: string): string {
  switch (code) {
    case "no_channel":
      return "Create a channel first.";
    case "bad_url":
      return "That picture didn't upload. Try again.";
    case "bad_show":
      return "Pick when it shows.";
    case "bad_time":
      return "Pick a start time within the video.";
    case "not_set_up":
      return "Watermarks aren't set up yet: run 044_watermarks.sql.";
    default:
      return "The watermark didn't save. Try again.";
  }
}
