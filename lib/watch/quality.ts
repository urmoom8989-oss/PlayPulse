// The quality menu of the player. No imports, so Node can load it directly.

/** One rendition as hls.js (or videos.renditions) knows it. */
export type Level = { height: number; width?: number; bitrate?: number; name?: string };

/** One row of the quality menu. level is the hls.js level index, -1 for Auto. */
export type QualityOption = { level: number; label: string; height: number; hd: boolean };

export const AUTO = -1;

/** "1080p", "720p", "432p": the short side, which is the height for landscape video. */
export function qualityLabel(l: Level): string {
  const side = l.width && l.width < l.height ? l.width : l.height;
  return `${side}p`;
}

/**
 * The rows of the quality menu, like 2019 YouTube: highest first, Auto last.
 * Two levels with the same size keep the one with the higher bitrate.
 * Levels without a size are left out.
 */
export function qualityOptions(levels: Level[]): QualityOption[] {
  const best = new Map<string, { index: number; level: Level }>();
  levels.forEach((level, index) => {
    if (!(level.height > 0)) return;
    const label = qualityLabel(level);
    const seen = best.get(label);
    if (!seen || (level.bitrate ?? 0) > (seen.level.bitrate ?? 0)) best.set(label, { index, level });
  });
  const rows = [...best.entries()]
    .map(([label, { index, level }]) => {
      const side = parseInt(label, 10);
      return { level: index, label, height: level.height, hd: side >= 720, side };
    })
    .sort((a, b) => b.side - a.side || b.height - a.height)
    .map(({ level, label, height, hd }) => ({ level, label, height, hd }));
  return [...rows, { level: AUTO, label: "Auto", height: 0, hd: false }];
}

/**
 * The level to start with from the remembered label ("720p" or "Auto"):
 * the same label if this video has it, else the highest one below it, else Auto.
 */
export function levelForSaved(options: QualityOption[], saved: string | null | undefined): number {
  if (!saved || saved === "Auto") return AUTO;
  const want = parseInt(saved, 10);
  if (!Number.isFinite(want)) return AUTO;
  const exact = options.find((o) => o.label === saved);
  if (exact) return exact.level;
  const lower = options.find((o) => o.level !== AUTO && parseInt(o.label, 10) <= want);
  return lower ? lower.level : AUTO;
}

/** What the gear menu shows next to "Quality": "Auto (720p)" or "1080p". */
export function qualitySummary(options: QualityOption[], chosen: number, playing: number): string {
  if (chosen === AUTO) {
    const now = options.find((o) => o.level === playing && o.level !== AUTO);
    return now ? `Auto (${now.label})` : "Auto";
  }
  return options.find((o) => o.level === chosen)?.label ?? "Auto";
}

/** The option the browser is playing, from the picture's size (for native HLS, where Auto is the browser's pick). */
export function levelForSize(options: QualityOption[], width: number, height: number): number {
  if (!(width > 0 && height > 0)) return AUTO;
  const label = `${Math.min(width, height)}p`;
  return options.find((o) => o.level !== AUTO && o.label === label)?.level ?? AUTO;
}

/** A rendition listed in a master playlist, with its playlist's full URL. */
export type Variant = Level & { uri: string };

/**
 * The renditions of an HLS master playlist (#EXT-X-STREAM-INF and the URI on
 * the next line), for browsers that play HLS themselves and have no hls.js:
 * picking a quality there means playing that rendition's playlist.
 */
export function parseVariants(master: string, baseUrl: string): Variant[] {
  const lines = String(master ?? "").split(/\r?\n/);
  const out: Variant[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.startsWith("#EXT-X-STREAM-INF:")) continue;
    const res = /RESOLUTION=(\d+)x(\d+)/.exec(line);
    const bw = /(?:^|[:,])BANDWIDTH=(\d+)/.exec(line);
    let j = i + 1;
    while (j < lines.length && (lines[j].trim() === "" || lines[j].trim().startsWith("#"))) j++;
    const uri = lines[j]?.trim();
    if (!uri || !res) continue;
    let full: string;
    try {
      full = new URL(uri, baseUrl).toString();
    } catch {
      continue;
    }
    out.push({ width: Number(res[1]), height: Number(res[2]), bitrate: bw ? Number(bw[1]) : undefined, uri: full });
    i = j;
  }
  return out;
}

/** The playback speeds in the gear menu, like YouTube. */
export const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2] as const;

export function speedLabel(rate: number): string {
  return rate === 1 ? "Normal" : String(rate);
}
