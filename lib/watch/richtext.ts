import { splitTimestamps } from "./chapters.ts";

/**
 * A description cut into its parts, like the 2020 watch page: links open in a
 * new tab, #hashtags lead to their page, and timestamps (with player extras)
 * jump the player. Every character is kept, in order.
 */
export type RichPart =
  | { kind: "text"; text: string }
  | { kind: "time"; text: string; seconds: number }
  | { kind: "link"; text: string; href: string }
  | { kind: "tag"; text: string; tag: string };

/** http(s) links and www. addresses, up to the next space. */
const LINK = /\b(?:https?:\/\/|www\.)[^\s<>"]+/giu;
/** A # at the start or after a space or punctuation, then letters, digits or _, with at least one letter. */
const TAG = /(^|[^\p{L}\p{N}_&#/])#([\p{L}\p{N}_]*\p{L}[\p{L}\p{N}_]*)/gu;
export const TAG_MAX = 100;

/** Drops punctuation a sentence put after a link: "see example.com." and "(example.com)". */
function trimLink(raw: string): string {
  let s = raw;
  for (;;) {
    const last = s.at(-1);
    if (!last) return s;
    if (".,!?;:'*".includes(last)) s = s.slice(0, -1);
    else if (last === ")" && (s.match(/\(/g)?.length ?? 0) < (s.match(/\)/g)?.length ?? 0)) s = s.slice(0, -1);
    else if (last === "]" && (s.match(/\[/g)?.length ?? 0) < (s.match(/\]/g)?.length ?? 0)) s = s.slice(0, -1);
    else return s;
  }
}

/** The address a link goes to, or null when it is not an http(s) link. */
export function linkHref(text: string): string | null {
  const full = /^www\./i.test(text) ? `https://${text}` : text;
  try {
    const url = new URL(full);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

/** The hashtag page for a tag: /hashtag/gaming. */
export function hashtagHref(tag: string): string {
  return `/hashtag/${encodeURIComponent(tag.toLowerCase())}`;
}

/** A tag from the address, cleaned: letters, digits and _ only, or null. */
export function cleanTag(raw: string): string | null {
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    // Kept as it came.
  }
  const tag = decoded.replace(/^#/, "").trim();
  return tag.length > 0 && tag.length <= TAG_MAX && /^[\p{L}\p{N}_]*\p{L}[\p{L}\p{N}_]*$/u.test(tag) ? tag : null;
}

function hashtagsAndTimes(text: string, times: boolean): RichPart[] {
  const parts: RichPart[] = [];
  const plain = (s: string) => {
    if (!s) return;
    if (!times) return void parts.push({ kind: "text", text: s });
    for (const p of splitTimestamps(s)) {
      parts.push(p.seconds === undefined ? { kind: "text", text: p.text } : { kind: "time", text: p.text, seconds: p.seconds });
    }
  };
  let at = 0;
  TAG.lastIndex = 0;
  for (let m = TAG.exec(text); m; m = TAG.exec(text)) {
    const start = m.index + m[1].length;
    const tag = m[2];
    if (tag.length > TAG_MAX) continue;
    plain(text.slice(at, start));
    parts.push({ kind: "tag", text: `#${tag}`, tag });
    at = start + 1 + tag.length;
  }
  plain(text.slice(at));
  return parts;
}

/** The description's parts. `times`: timestamps too (player extras). */
export function splitRich(text: string, { times = false }: { times?: boolean } = {}): RichPart[] {
  const parts: RichPart[] = [];
  let at = 0;
  LINK.lastIndex = 0;
  for (let m = LINK.exec(text); m; m = LINK.exec(text)) {
    const raw = trimLink(m[0]);
    const href = linkHref(raw);
    if (!href || raw.length < 5) continue;
    parts.push(...hashtagsAndTimes(text.slice(at, m.index), times));
    parts.push({ kind: "link", text: raw, href });
    at = m.index + raw.length;
    LINK.lastIndex = at;
  }
  parts.push(...hashtagsAndTimes(text.slice(at), times));
  // Neighbouring text parts become one.
  return parts.reduce<RichPart[]>((out, p) => {
    const last = out.at(-1);
    if (p.kind === "text" && last?.kind === "text") last.text += p.text;
    else out.push(p.kind === "text" ? { ...p } : p);
    return out;
  }, []);
}
