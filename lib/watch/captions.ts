// Captions in the player (player extras). The encoder lists auto-generated
// captions as an HLS subtitle rendition in master.m3u8 (worker/lib/captions.mjs).
// The player reads that list itself, fetches the WebVTT and draws the words in
// the style the viewer picked, so they look the same in every browser.
// No imports, so Node can load it directly.

export type CaptionTrack = {
  /** The subtitle playlist's URL, which also tells tracks apart. */
  id: string;
  /** "en", or "" when the playlist does not say. */
  lang: string;
  /** "English (auto-generated)" */
  name: string;
};

export type CaptionCue = { start: number; end: number; text: string };

/** The attributes of an HLS tag line. Quoted values may hold commas. */
export function hlsAttributes(line: string): Record<string, string> {
  const out: Record<string, string> = {};
  const body = line.slice(line.indexOf(":") + 1);
  const re = /([A-Z0-9-]+)=("[^"]*"|[^,]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    const v = m[2];
    out[m[1]] = v.startsWith('"') ? v.slice(1, -1) : v;
  }
  return out;
}

/** The subtitle tracks a master playlist lists, in its order, with absolute URLs. */
export function parseSubtitleTracks(master: string, masterUrl: string): CaptionTrack[] {
  const tracks: CaptionTrack[] = [];
  for (const raw of master.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line.startsWith("#EXT-X-MEDIA:")) continue;
    const a = hlsAttributes(line);
    if (a.TYPE !== "SUBTITLES" || !a.URI) continue;
    let id: string;
    try {
      id = new URL(a.URI, masterUrl).toString();
    } catch {
      continue;
    }
    if (tracks.some((t) => t.id === id)) continue;
    const lang = (a.LANGUAGE ?? "").trim();
    tracks.push({ id, lang, name: (a.NAME ?? "").trim() || lang || "Subtitles" });
  }
  return tracks;
}

/** The WebVTT files a subtitle playlist names, absolute. A plain .vtt is its own one file. */
export function subtitleSegments(playlist: string, playlistUrl: string): string[] {
  if (/^\s*WEBVTT/.test(playlist)) return [playlistUrl];
  const out: string[] = [];
  for (const raw of playlist.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    try {
      out.push(new URL(line, playlistUrl).toString());
    } catch {
      // Not a URL: skip it.
    }
  }
  return out;
}

/** "01:02:05.250" or "02:05.250" -> 3725.25 */
function cueSeconds(text: string): number {
  const parts = text.split(":");
  if (parts.length < 2 || parts.length > 3) return NaN;
  const [h, m, s] = parts.length === 3 ? parts : ["0", ...parts];
  return Number(h) * 3600 + Number(m) * 60 + Number(s);
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", lrm: "", rlm: "" };

/** Cue text as plain words: tags (<i>, <c.color>, <00:01.000>) out, entities decoded. */
export function cueText(raw: string): string {
  return raw
    .replace(/<[^>]*>/g, "")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, name: string) => {
      if (name[0] === "#") {
        const code = name[1] === "x" || name[1] === "X" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
        return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : "";
      }
      return ENTITIES[name.toLowerCase()] ?? all;
    })
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .join("\n");
}

const TIMING = /^\s*((?:\d+:)?\d{1,2}:\d{2}(?:\.\d{1,3})?)\s+-->\s+((?:\d+:)?\d{1,2}:\d{2}(?:\.\d{1,3})?)/;

/** Every cue of a caption file, by start time. Headers, notes, styles and broken cues are skipped. */
export function parseCaptionVtt(text: string): CaptionCue[] {
  const cues: CaptionCue[] = [];
  for (const block of text.replace(/\r\n?/g, "\n").split(/\n{2,}/)) {
    const lines = block.split("\n");
    const i = lines.findIndex((l) => l.includes("-->"));
    if (i < 0) continue;
    const m = TIMING.exec(lines[i]);
    if (!m) continue;
    const start = cueSeconds(m[1]);
    const end = cueSeconds(m[2]);
    const words = cueText(lines.slice(i + 1).join("\n"));
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || !words) continue;
    cues.push({ start, end, text: words });
  }
  return cues.sort((a, b) => a.start - b.start);
}

/** The cues on screen at time t, oldest first. Looks back over at most 8 overlapping cues. */
export function activeCues(cues: CaptionCue[], t: number): CaptionCue[] {
  if (cues.length === 0 || !Number.isFinite(t) || t < cues[0].start) return [];
  let lo = 0;
  let hi = cues.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (cues[mid].start <= t) lo = mid;
    else hi = mid - 1;
  }
  const out: CaptionCue[] = [];
  for (let i = lo; i >= 0 && i > lo - 8; i--) if (cues[i].end > t) out.unshift(cues[i]);
  return out;
}

/** The viewer's track: the one in their language, or else the first. */
export function pickTrack(tracks: CaptionTrack[], lang: string | null): CaptionTrack | null {
  if (tracks.length === 0) return null;
  const want = (lang ?? "").toLowerCase();
  return (want && tracks.find((t) => t.lang.toLowerCase() === want)) || tracks[0];
}

// How captions look -----------------------------------------------------------------

export const CAPTION_FONTS = [
  { value: "sans", label: "Proportional Sans-Serif", css: "Roboto, Arial, Helvetica, Verdana, sans-serif" },
  { value: "mono-sans", label: "Monospaced Sans-Serif", css: '"DejaVu Sans Mono", "Lucida Console", Monaco, Consolas, monospace' },
  { value: "serif", label: "Proportional Serif", css: 'Georgia, "Times New Roman", Times, serif' },
  { value: "mono-serif", label: "Monospaced Serif", css: '"Courier New", Courier, "Nimbus Mono L", monospace' },
  { value: "casual", label: "Casual", css: '"Comic Sans MS", "Comic Neue", "Chalkboard SE", cursive' },
  { value: "cursive", label: "Cursive", css: '"Monotype Corsiva", "URW Chancery L", "Apple Chancery", cursive' },
  { value: "small-caps", label: "Small Capitals", css: "Roboto, Arial, Helvetica, Verdana, sans-serif" },
] as const;

export const CAPTION_COLORS = [
  { value: "white", label: "White", rgb: "255, 255, 255" },
  { value: "yellow", label: "Yellow", rgb: "255, 255, 0" },
  { value: "green", label: "Green", rgb: "0, 255, 0" },
  { value: "cyan", label: "Cyan", rgb: "0, 255, 255" },
  { value: "blue", label: "Blue", rgb: "0, 0, 255" },
  { value: "magenta", label: "Magenta", rgb: "255, 0, 255" },
  { value: "red", label: "Red", rgb: "255, 0, 0" },
  { value: "black", label: "Black", rgb: "8, 8, 8" },
] as const;

export const CAPTION_EDGES = [
  { value: "none", label: "None" },
  { value: "shadow", label: "Drop Shadow" },
  { value: "raised", label: "Raised" },
  { value: "depressed", label: "Depressed" },
  { value: "outline", label: "Outline" },
] as const;

/** Font size in percent of the normal size. */
export const CAPTION_SIZES = [50, 75, 100, 150, 200, 300, 400] as const;
export const CAPTION_OPACITIES = [0, 25, 50, 75, 100] as const;
export const CAPTION_FONT_OPACITIES = [25, 50, 75, 100] as const;

export type CaptionStyle = {
  font: (typeof CAPTION_FONTS)[number]["value"];
  color: (typeof CAPTION_COLORS)[number]["value"];
  size: (typeof CAPTION_SIZES)[number];
  fontOpacity: (typeof CAPTION_FONT_OPACITIES)[number];
  bg: (typeof CAPTION_COLORS)[number]["value"];
  bgOpacity: (typeof CAPTION_OPACITIES)[number];
  edge: (typeof CAPTION_EDGES)[number]["value"];
};

export type CaptionSetting = keyof CaptionStyle;

/** White words on a 75% black box, like everybody's default. */
export const DEFAULT_CAPTION_STYLE: CaptionStyle = {
  font: "sans",
  color: "white",
  size: 100,
  fontOpacity: 100,
  bg: "black",
  bgOpacity: 75,
  edge: "none",
};

/** The rows of the caption options menu, in order. */
export const CAPTION_SETTINGS: { key: CaptionSetting; label: string }[] = [
  { key: "font", label: "Font family" },
  { key: "color", label: "Font color" },
  { key: "size", label: "Font size" },
  { key: "bg", label: "Background color" },
  { key: "bgOpacity", label: "Background opacity" },
  { key: "fontOpacity", label: "Font opacity" },
  { key: "edge", label: "Character edge style" },
];

export type CaptionChoice = { value: string | number; label: string };

const percent = (n: number) => `${n}%`;

/** The choices of one setting, for its menu. */
export function captionChoices(key: CaptionSetting): CaptionChoice[] {
  switch (key) {
    case "font":
      return CAPTION_FONTS.map(({ value, label }) => ({ value, label }));
    case "color":
    case "bg":
      return CAPTION_COLORS.map(({ value, label }) => ({ value, label }));
    case "edge":
      return CAPTION_EDGES.map(({ value, label }) => ({ value, label }));
    case "size":
      return CAPTION_SIZES.map((value) => ({ value, label: percent(value) }));
    case "bgOpacity":
      return CAPTION_OPACITIES.map((value) => ({ value, label: percent(value) }));
    case "fontOpacity":
      return CAPTION_FONT_OPACITIES.map((value) => ({ value, label: percent(value) }));
  }
}

/** What the options menu shows next to a setting. */
export function captionValueLabel(style: CaptionStyle, key: CaptionSetting): string {
  return captionChoices(key).find((c) => c.value === style[key])?.label ?? "";
}

/** The style with one setting changed. A value that is not one of the choices changes nothing. */
export function setCaptionSetting(style: CaptionStyle, key: CaptionSetting, value: string | number): CaptionStyle {
  if (!captionChoices(key).some((c) => c.value === value)) return style;
  return { ...style, [key]: value };
}

/** Anything (a remembered style, say) as a valid style: unknown values become the default. */
export function normalizeCaptionStyle(raw: unknown): CaptionStyle {
  const src = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  let style = DEFAULT_CAPTION_STYLE;
  for (const { key } of CAPTION_SETTINGS) {
    const v = src[key];
    if (typeof v === "string" || typeof v === "number") style = setCaptionSetting(style, key, v);
  }
  return style;
}

/** The next font size up (+1) or down (-1), stopping at the ends. */
export function stepCaptionSize(size: number, step: 1 | -1): CaptionStyle["size"] {
  const i = CAPTION_SIZES.indexOf(size as CaptionStyle["size"]);
  const at = i < 0 ? CAPTION_SIZES.indexOf(100) : i;
  return CAPTION_SIZES[Math.min(CAPTION_SIZES.length - 1, Math.max(0, at + step))];
}

const EDGE_SHADOWS: Record<CaptionStyle["edge"], string> = {
  none: "none",
  shadow: "2px 2px 3px rgba(34, 34, 34, 0.75), 2px 2px 4px rgba(34, 34, 34, 0.75), 2px 2px 5px rgba(34, 34, 34, 0.75)",
  raised: "1px 1px rgba(34, 34, 34, 0.9), 2px 2px rgba(34, 34, 34, 0.9), 3px 3px rgba(34, 34, 34, 0.9)",
  depressed: "1px 1px rgba(204, 204, 204, 0.5), -1px -1px rgba(34, 34, 34, 0.75)",
  outline: "0 0 2px #222, 0 0 2px #222, 0 0 2px #222, 0 0 2px #222, 0 0 2px #222",
};

/** The normal (100%) caption size for a player this many pixels high: 4.5% of it, at least 10 px. */
export function baseCaptionPx(playerHeight: number): number {
  return Math.max(10, (Number.isFinite(playerHeight) ? playerHeight : 0) * 0.045);
}

/** The inline style of one line of caption text. */
export function captionCss(style: CaptionStyle, playerHeight: number) {
  const rgb = (value: string) => CAPTION_COLORS.find((c) => c.value === value)?.rgb ?? "255, 255, 255";
  const font = CAPTION_FONTS.find((f) => f.value === style.font) ?? CAPTION_FONTS[0];
  return {
    fontSize: `${Math.round(baseCaptionPx(playerHeight) * style.size) / 100}px`,
    fontFamily: font.css,
    fontVariant: style.font === "small-caps" ? "small-caps" : "normal",
    color: `rgba(${rgb(style.color)}, ${style.fontOpacity / 100})`,
    backgroundColor: `rgba(${rgb(style.bg)}, ${style.bgOpacity / 100})`,
    textShadow: EDGE_SHADOWS[style.edge],
  };
}

// What the browser remembers ------------------------------------------------------

export type CaptionPrefs = { on: boolean; lang: string | null; style: CaptionStyle };

export const DEFAULT_CAPTION_PREFS: CaptionPrefs = { on: false, lang: null, style: DEFAULT_CAPTION_STYLE };

/** The remembered captions settings (from lib/watch/prefs.ts), however broken. */
export function parseCaptionPrefs(text: string | null): CaptionPrefs {
  if (!text) return DEFAULT_CAPTION_PREFS;
  try {
    const raw = JSON.parse(text) as Record<string, unknown> | null;
    const lang = typeof raw?.lang === "string" && /^[A-Za-z]{2,3}(-[A-Za-z0-9]{1,8})*$/.test(raw.lang) ? raw.lang : null;
    return { on: raw?.on === true, lang, style: normalizeCaptionStyle(raw?.style) };
  } catch {
    return DEFAULT_CAPTION_PREFS;
  }
}

export function captionPrefsText(prefs: CaptionPrefs): string {
  return JSON.stringify({ on: prefs.on, lang: prefs.lang, style: prefs.style });
}
