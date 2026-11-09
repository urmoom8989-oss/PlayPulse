// Channel bots (030_bots.sql): for channels with bots_on (@typicalgamer),
// views, likes, dislikes, subscribers and comments that react to moments in
// each video's captions; during its Premieres and live broadcasts, viewers
// and live chat. Runs beside the encode loop, whatever it is doing, while the
// bots flag is not off.
import { makeChatLine, makeComment, parseVtt } from "./bottext.mjs";

/** Resolves after ms, or right away when the signal aborts. */
function sleep(ms, signal) {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    let t;
    const done = () => {
      clearTimeout(t);
      signal?.removeEventListener("abort", done);
      resolve();
    };
    t = setTimeout(done, ms);
    signal?.addEventListener("abort", done, { once: true });
  });
}

/** The slow round (views, likes, comments, subscribers) runs this often. */
export const BOTS_EVERY_MS = 10 * 60 * 1000;
/** The fast round (live viewers and chat) runs this often while a broadcast is on or near. */
export const BOTS_LIVE_EVERY_MS = 15 * 1000;
/** Rounds in a day of the slow round. */
const ROUNDS_PER_DAY = (24 * 60 * 60 * 1000) / BOTS_EVERY_MS;

/**
 * How much of the daily views a video gets, by age: all of it the first day,
 * then less and less (a third at a week, about a tenth at two months).
 */
export function ageFactor(publishedAt, now) {
  const days = Math.max(0, (now - Date.parse(publishedAt)) / 86400000);
  if (!Number.isFinite(days)) return 0;
  return days < 1 ? 1 : 1 / Math.pow(days, 0.55);
}

/** A whole number near `mean` (Poisson for small means, normal around big ones). */
export function around(mean, rand = Math.random) {
  if (!(mean > 0)) return 0;
  if (mean < 30) {
    const l = Math.exp(-mean);
    let k = 0;
    let p = 1;
    do {
      k++;
      p *= rand();
    } while (p > l);
    return k - 1;
  }
  const z = Math.sqrt(-2 * Math.log(Math.max(rand(), 1e-12))) * Math.cos(2 * Math.PI * rand());
  return Math.max(0, Math.round(mean + z * Math.sqrt(mean)));
}

/** "upcoming", "live" or "ended", like broadcast_state() in 029_live.sql. */
export function broadcastState(v, now) {
  if (!v.broadcast_at) return null;
  const at = Date.parse(v.broadcast_at);
  if (now < at) return "upcoming";
  return now < at + Number(v.duration_s || 0) * 1000 ? "live" : "ended";
}

/** The bot RPCs, on top of the service role Supabase client. */
export function createBotDb(supabase) {
  const call = async (name, args) => {
    const { data, error } = await supabase.rpc(name, args);
    if (error) throw new Error(`${name}: ${error.message ?? "database error"}`);
    return data;
  };
  return {
    async on() {
      const { data, error } = await supabase.from("feature_flags").select("mode").eq("key", "bots").maybeSingle();
      if (error) throw new Error(`bots flag: ${error.message}`);
      return Boolean(data && data.mode !== "off");
    },
    async settings() {
      const rows = await call("bot_get_settings", {});
      return (Array.isArray(rows) ? rows[0] : rows) ?? null;
    },
    targets: async () => (await call("bot_targets", {})) ?? [],
    addViews: (videoId, n) => call("bot_add_views", { video_id: videoId, n }),
    react: (videoId, likes, dislikes) => call("bot_react", { video_id: videoId, likes, dislikes }),
    subscribe: (n) => call("bot_subscribe", { n }),
    comment: (videoId, body) => call("bot_comment", { video_id: videoId, body }),
    likeComments: (videoId, n) => call("bot_like_comments", { video_id: videoId, n }),
    recentComments: async (videoId) => ((await call("bot_recent_comments", { video_id: videoId })) ?? []).map((r) => r.body),
    chat: (videoId, body) => call("bot_chat", { video_id: videoId, body }),
    presence: (videoId, n) => call("bot_presence", { video_id: videoId, n }),
  };
}

/** Each video's caption cues, read from storage once per hour. */
export function createCueCache(storage, { now = Date.now, ttlMs = 60 * 60 * 1000 } = {}) {
  const cache = new Map();
  return async function cuesFor(video) {
    const hit = cache.get(video.id);
    if (hit && now() - hit.at < ttlMs) return hit.cues;
    let cues = [];
    const folder = String(video.hls_key || `hls/${video.id}/master.m3u8`).replace(/\/[^/]*$/, "");
    for (const lang of ["en", "es", "fr", "de", "pt", "ja"]) {
      const text = await storage.getText?.(`${folder}/captions/${lang}.vtt`).catch(() => null);
      if (text) {
        cues = parseVtt(text);
        break;
      }
    }
    cache.set(video.id, { at: now(), cues });
    return cues;
  };
}

/**
 * The slow round: for every bot video, its share of the day's views, likes
 * and dislikes from those views, now and then a comment about a moment in it
 * and likes on comments; and a few subscribers for the channel.
 */
export async function slowRound({ db, cuesFor, log, now = Date.now, rand = Math.random }) {
  const settings = await db.settings();
  if (!settings) return { videos: 0 };
  const videos = await db.targets();
  let views = 0;
  let comments = 0;
  for (const v of videos) {
    if (broadcastState(v, now()) === "upcoming") continue;
    const n = around((Number(settings.views_per_day) / ROUNDS_PER_DAY) * ageFactor(v.published_at, now()), rand);
    if (n > 0) {
      await db.addViews(v.id, n);
      views += n;
      const likes = around(n * Number(settings.like_rate), rand);
      const dislikes = around(n * Number(settings.dislike_rate), rand);
      if (likes + dislikes > 0) await db.react(v.id, likes, dislikes);
    }
    const wanted = around(Math.max(n, 1) * Number(settings.comment_rate) * (n > 0 ? 1 : 0.2), rand);
    if (wanted > 0 && v.comments_mode === "on") {
      const cues = await cuesFor(v);
      const said = new Set((await db.recentComments(v.id)).map((b) => String(b).toLowerCase()));
      for (let k = 0; k < Math.min(wanted, 5); k++) {
        let body = "";
        for (let tries = 0; tries < 6 && (!body || said.has(body.toLowerCase())); tries++) {
          body = makeComment({ title: v.title, description: v.description, cues, now: now(), rand });
        }
        if (!body || said.has(body.toLowerCase())) continue;
        if (await db.comment(v.id, body)) {
          said.add(body.toLowerCase());
          comments++;
        }
      }
      if (rand() < 0.5) await db.likeComments(v.id, 1 + Math.floor(rand() * 3));
    }
  }
  const subs = around(Number(settings.subscribers_per_day) / ROUNDS_PER_DAY, rand);
  if (subs > 0) await db.subscribe(subs);
  log("bots", { videos: videos.length, views, comments, subs }, "round done");
  return { videos: videos.length, views, comments, subs };
}

/**
 * The fast round, while a bot video's broadcast is on (or starts within 15
 * minutes): bot viewers, and a few chat lines about what is on screen.
 * Answers whether any broadcast was near, so the caller can slow down.
 */
export async function liveRound({ db, cuesFor, now = Date.now, rand = Math.random, videos }) {
  const settings = await db.settings();
  if (!settings) return false;
  const list = videos ?? (await db.targets());
  let near = false;
  for (const v of list) {
    const state = broadcastState(v, now());
    const startsIn = v.broadcast_at ? Date.parse(v.broadcast_at) - now() : Infinity;
    if (!(state === "live" || (state === "upcoming" && startsIn < 15 * 60 * 1000))) continue;
    near = true;
    const min = Number(settings.live_viewers_min);
    const max = Math.max(min, Number(settings.live_viewers_max));
    const target = state === "upcoming" ? Math.round(min / 2) : min + Math.floor(rand() * (max - min + 1));
    await db.presence(v.id, target);
    const lines = around((Number(settings.chat_per_minute) * BOTS_LIVE_EVERY_MS) / 60000, rand);
    const cues = state === "live" ? await cuesFor(v) : [];
    const at = (now() - Date.parse(v.broadcast_at)) / 1000;
    for (let k = 0; k < Math.min(lines, 4); k++) {
      await db.chat(v.id, state === "upcoming" ? makeChatLine({ rand }) : makeChatLine({ cues, at, rand }));
    }
  }
  return near;
}

/** Runs the rounds until the stop signal aborts. Errors are logged and the next round tries again. */
export async function runBots({ db, storage, log, stopSignal, now = Date.now }) {
  const cuesFor = createCueCache(storage, { now });
  let lastSlow = -Infinity;
  let lastTargets = { at: -Infinity, list: [] };
  log("bots", {}, "bots ready (they run while the bots flag is not off)");
  while (!stopSignal?.aborted) {
    let near = false;
    try {
      if (await db.on()) {
        if (now() - lastSlow >= BOTS_EVERY_MS) {
          lastSlow = now();
          await slowRound({ db, cuesFor, log, now });
        }
        if (now() - lastTargets.at >= 60 * 1000) lastTargets = { at: now(), list: await db.targets() };
        near = await liveRound({ db, cuesFor, now, videos: lastTargets.list });
      }
    } catch (err) {
      log("bots", {}, `round failed: ${err.message}`);
    }
    await sleep(near ? BOTS_LIVE_EVERY_MS : 60 * 1000, stopSignal);
  }
}
