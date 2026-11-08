// Timestamps and chapters in a video's description (player extras).
// No imports on purpose, so Node can load this file directly in the tests.

/** At least this many chapters, like YouTube in 2020. */
export const CHAPTER_MIN_COUNT = 3;
/** Every chapter is at least this long, in seconds. */
export const CHAPTER_MIN_S = 10;
/** Chapter titles longer than this are cut. */
export const CHAPTER_TITLE_MAX = 100;

export type Chapter = {
  /** Seconds from the start. The first chapter always starts at 0. */
  start: number;
  /** Where the next chapter starts, or the video's length. Null when the length is unknown. */
  end: number | null;
  title: string;
};

/** A piece of text: plain, or a timestamp with the second it points at. */
export type TextPart = { text: string; seconds?: number };

/**
 * m:ss, mm:ss or h:mm:ss, not glued to letters, digits, colons or dots on
 * either side (so 10:30am, 1.12:30 and 12:34:567 are not timestamps). The
 * character before is matched (not a lookbehind) so older Safari can run it.
 */
const TIMESTAMP = /(^|[^\w:.])((?:(\d{1,2}):)?(\d{1,2}):(\d{2}))(?![\w:])/g;

function secondsFrom(h: string | undefined, m: string, s: string): number | null {
  const hours = h === undefined ? 0 : Number(h);
  const minutes = Number(m);
  const seconds = Number(s);
  if (seconds > 59) return null;
  if (h !== undefined && minutes > 59) return null;
  return hours * 3600 + minutes * 60 + seconds;
}

/** "1:05" -> 65, "1:02:05" -> 3725. Null for anything else. */
export function parseTimestamp(text: string): number | null {
  const m = /^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})$/.exec(text.trim());
  return m ? secondsFrom(m[1], m[2], m[3]) : null;
}

/** Every timestamp in the text with where it starts and ends. */
function timestampsIn(text: string): { index: number; length: number; seconds: number }[] {
  const out: { index: number; length: number; seconds: number }[] = [];
  TIMESTAMP.lastIndex = 0;
  for (let m = TIMESTAMP.exec(text); m; m = TIMESTAMP.exec(text)) {
    const seconds = secondsFrom(m[3], m[4], m[5]);
    if (seconds !== null) out.push({ index: m.index + m[1].length, length: m[2].length, seconds });
  }
  return out;
}

/** The text cut into plain parts and timestamp parts, keeping every character. */
export function splitTimestamps(text: string): TextPart[] {
  const parts: TextPart[] = [];
  let at = 0;
  for (const t of timestampsIn(text)) {
    if (t.index > at) parts.push({ text: text.slice(at, t.index) });
    parts.push({ text: text.slice(t.index, t.index + t.length), seconds: t.seconds });
    at = t.index + t.length;
  }
  if (at < text.length) parts.push({ text: text.slice(at) });
  return parts;
}

/** A chapter line without its timestamp, list marker and separators. */
function cleanTitle(before: string, after: string): string {
  const joined = `${before} ${after}`
    .replace(/^\s*(?:\d+[.)]|[-*\u2022\u00b7])\s+/, "")
    .replace(/^[\s\-\u2013\u2014:|\u2022\u00b7()[\]]+/, "")
    .replace(/[\s\-\u2013\u2014:|\u2022\u00b7()[\]]+$/, "")
    .replace(/\s+/g, " ")
    .trim();
  return joined.slice(0, CHAPTER_TITLE_MAX).trim();
}

/**
 * Chapters from a description, with YouTube's 2020 rules: the list starts at
 * a line with 0:00, has at least 3 chapters in order, and every chapter is at
 * least 10 seconds long (the last one too, when the length is known). The
 * list is the 0:00 line and the lines right under it that have a timestamp:
 * a blank line or a line without one ends it, so a later sentence like "skip
 * to 4:20" is not a chapter. Anything else gives no chapters.
 */
export function parseChapters(description: string, durationS: number | null = null): Chapter[] {
  const found: { start: number; title: string }[] = [];
  let collecting = false;
  for (const line of description.split(/\r?\n/)) {
    const first = timestampsIn(line)[0];
    if (!first) {
      if (collecting) break;
      continue;
    }
    if (!collecting) {
      if (first.seconds !== 0) continue;
      collecting = true;
    }
    found.push({
      start: first.seconds,
      title: cleanTitle(line.slice(0, first.index), line.slice(first.index + first.length)),
    });
  }

  if (found.length < CHAPTER_MIN_COUNT) return [];
  for (let i = 1; i < found.length; i++) {
    if (found[i].start - found[i - 1].start < CHAPTER_MIN_S) return [];
  }
  const length = durationS !== null && Number.isFinite(durationS) && durationS > 0 ? durationS : null;
  if (length !== null && length - found[found.length - 1].start < CHAPTER_MIN_S) return [];

  return found.map((c, i) => ({
    start: c.start,
    end: i + 1 < found.length ? found[i + 1].start : length,
    title: c.title || `Chapter ${i + 1}`,
  }));
}

/** The chapter playing at `t` seconds, as an index, or -1 when there are none. */
export function chapterAt(chapters: readonly Chapter[], t: number): number {
  let index = -1;
  for (let i = 0; i < chapters.length; i++) {
    if (chapters[i].start <= t) index = i;
    else break;
  }
  return chapters.length > 0 ? Math.max(0, index) : -1;
}
