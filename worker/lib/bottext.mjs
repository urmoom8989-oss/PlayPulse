// What the channel bots say (030_bots.sql, worker/lib/bots.mjs): comments
// that react to real moments of a video, read from its auto-generated
// captions, and live chat lines. Plain functions with a random source passed
// in, so the tests can fix it. No imports.

/** A caption cue: when it starts (seconds) and what is said. */
/** @typedef {{ start: number, end: number, text: string }} Cue */

/** "1:05" or "1:02:05", like the timestamps the site turns into links. */
export function stamp(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const pad = (n) => String(n).padStart(2, "0");
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
}

function toSeconds(t) {
  const parts = t.trim().split(":").map(Number);
  if (parts.some((n) => !Number.isFinite(n))) return NaN;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

/** The cues of a WebVTT file (the encoder's captions), with tags and line breaks gone. */
export function parseVtt(text) {
  const cues = [];
  const blocks = String(text ?? "").replace(/\r/g, "").split(/\n\n+/);
  for (const block of blocks) {
    const lines = block.split("\n");
    const i = lines.findIndex((l) => l.includes("-->"));
    if (i < 0) continue;
    const [a, b] = lines[i].split("-->");
    const start = toSeconds(a);
    const end = toSeconds(b.trim().split(/\s+/)[0]);
    const words = lines
      .slice(i + 1)
      .join(" ")
      .replace(/<[^>]*>/g, "")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/\s+/g, " ")
      .trim();
    if (Number.isFinite(start) && words) cues.push({ start, end: Number.isFinite(end) ? end : start, text: words });
  }
  return cues;
}

/** Chapters from a description: lines with a timestamp and a title. */
export function chaptersOf(description) {
  const out = [];
  for (const line of String(description ?? "").split("\n")) {
    const m = /(?:^|\s|\[)(\d{1,2}:\d{2}(?::\d{2})?)\]?\s*[-–:]?\s*(.{3,60})$/.exec(line.trim());
    if (m) out.push({ start: toSeconds(m[1]), title: m[2].trim() });
  }
  return out;
}

const STOP = new Set(
  "the a an and or but of to in on at for with my your our this that these those is are was were be been it its i im i'm you we they he she me us them from by as so just about into over out up down vs part new video official".split(" "),
);

/** The words of a title worth reacting to ("speedrun", "castle"), longest first. */
export function keywords(title) {
  const words = String(title ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s']/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !STOP.has(w) && !/^\d+$/.test(w));
  return [...new Set(words)].sort((a, b) => b.length - a.length);
}

/** A short quote from a cue: whole words, at most `max` characters, no end punctuation. */
export function quoteOf(text, max = 60) {
  const clean = String(text).replace(/^[-–\s]+/, "").replace(/\s+/g, " ").trim();
  let out = "";
  for (const w of clean.split(" ")) {
    if ((out ? out.length + 1 : 0) + w.length > max) break;
    out = out ? `${out} ${w}` : w;
  }
  // Never end a cut quote on a little word ("built the" reads cut off).
  let words = (out || clean.slice(0, max)).split(" ");
  if (out !== clean) {
    while (words.length > 3 && STOP.has(words[words.length - 1].toLowerCase().replace(/[^a-z']/g, ""))) words = words.slice(0, -1);
  }
  return words.join(" ").replace(/[.,!?;:]+$/, "");
}

const pick = (list, rand) => list[Math.floor(rand() * list.length) % list.length];

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** Makes a comment read like a person typed it: sometimes all lowercase, sometimes no final punctuation. */
function casual(text, rand) {
  let t = text;
  if (rand() < 0.35) t = t.toLowerCase();
  if (rand() < 0.4) t = t.replace(/[.!]+$/, "");
  return t;
}

/**
 * One comment about the video. Most quote or point at a real moment from the
 * captions ("2:31 "no way he made that jump" 😂"), some name a chapter or a
 * word from the title, the rest are the general things people write.
 */
export function makeComment({ title = "", description = "", cues = [], now = Date.now(), rand = Math.random } = {}) {
  const good = cues.filter((c) => c.text.split(" ").length >= 3);
  const chapters = chaptersOf(description);
  const words = keywords(title);
  const roll = rand();

  if (good.length && roll < 0.55) {
    const c = pick(good, rand);
    const at = stamp(c.start);
    const q = quoteOf(c.text, rand() < 0.7 ? 70 : 30 + Math.floor(rand() * 30));
    const forms = [
      () => `${at} "${q}" 😂`,
      () => `"${q}" 💀💀`,
      () => `${at} had me dying`,
      () => `the way he said "${q}" lmao`,
      () => `${at} is the best part`,
      () => `nobody gonna talk about ${at}?`,
      () => `${at} bro really said "${q}"`,
      () => `"${q}" is a whole mood`,
      () => `${at} I replayed this like 5 times`,
      () => `when he said "${q}" I lost it`,
      () => `${at} 😭😭`,
      () => `${at} that was actually insane`,
    ];
    return casual(pick(forms, rand)(), rand);
  }
  if (chapters.length && roll < 0.65) {
    const ch = pick(chapters, rand);
    return casual(pick([`${ch.title} was the best part`, `${stamp(ch.start)} ${ch.title} 🔥`, `the ${ch.title.toLowerCase()} part was so good`], rand), rand);
  }
  if (words.length && roll < 0.8) {
    const w = pick(words.slice(0, 3), rand);
    return casual(
      pick(
        [
          `this ${w} video is actually so good`,
          `been waiting for a ${w} video!`,
          `${w} content just hits different`,
          `best ${w} video on this site no cap`,
          `more ${w} videos please`,
        ],
        rand,
      ),
      rand,
    );
  }
  const d = new Date(now);
  return casual(
    pick(
      [
        "first time watching your channel and I'm already subscribed",
        `who's watching in ${MONTHS[d.getMonth()]} ${d.getFullYear()}?`,
        "the editing on this is crazy good",
        "you deserve way more subs",
        "this needs more views",
        "underrated channel fr",
        "your videos always make my day",
        "came here from recommended, not disappointed",
        "the quality of these videos keeps getting better",
        "W video",
        "how does this only have this many views??",
        "watched the whole thing, no skips",
      ],
      rand,
    ),
    rand,
  );
}

/** A live chat line: about what is being said right now, or the usual stream chat. */
export function makeChatLine({ cues = [], at = 0, rand = Math.random } = {}) {
  const near = cues.filter((c) => c.start <= at + 2 && c.end >= at - 20 && c.text.split(" ").length >= 2);
  if (near.length && rand() < 0.4) {
    const q = quoteOf(pick(near, rand).text, 40);
    return pick([`"${q}" LMAO`, `${q} 😂`, `nah "${q}" 💀`, `LOL "${q}"`], rand);
  }
  return pick(
    [
      "LETS GOOO",
      "W stream",
      "hi from Brazil 🇧🇷",
      "first time catching one of these live",
      "this is so good",
      "🔥🔥🔥",
      "LMAOO",
      "no way",
      "W",
      "hello chat",
      "just got here what did I miss",
      "clip that",
      "bro is cracked",
      "GG",
      "😂😂😂",
      "who else got the notification",
    ],
    rand,
  );
}
