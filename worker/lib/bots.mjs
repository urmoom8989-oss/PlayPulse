// Channel bots (030_bots.sql, 034_bot_panel.sql, 035_bots_at_once.sql): for
// channels with bots_on (@typicalgamer), only what the owner orders in the
// studio's Bots page. An "all at once" order gets its views, likes, dislikes
// and subscribers from the database the moment it is placed; this worker
// writes its comments (reacting to moments in the video's captions) a few
// seconds later. Orders spread over an hour, a day or a week get their share
// every few seconds. During the Premieres and live broadcasts the owner
// switched bots on for: viewers and live chat. Runs beside the encode loop,
// whatever it is doing, while the bots flag is not off.
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

/** Orders get their next share this often (an "all at once" order's comments come within this). */
export const BOTS_EVERY_MS = 5 * 1000;
/** The fast round (live viewers and chat) runs this often while a broadcast is on or near. */
export const BOTS_LIVE_EVERY_MS = 15 * 1000;
/** The most comments one order gets in one round (bot_deliver() adds any number of the rest at once). */
export const ROUND_CAP = { comments: 100 };
/** Tries for one comment that is not on the video yet, before the round stops writing them. */
export const COMMENT_TRIES = 40;
/**
 * Comments that could not be written because there was nothing new to say
 * keep being tried this long after the order's window ends (the captions of a
 * new video may come in meanwhile, with new moments to talk about), then are
 * dropped so the order can finish.
 */
export const COMMENTS_GIVE_UP_AFTER_MS = 6 * 60 * 60 * 1000;
/** bot_grow() makes at most this many accounts a call; the pool never passes POOL_MAX (034_bot_panel.sql). */
export const GROW_BY = 250;
export const POOL_MAX = 10000;

const KINDS = ["views", "likes", "dislikes", "comments", "subscribers"];

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
    dueOrders: async () => (await call("bot_due_orders", {})) ?? [],
    deliver: async (orderId, d) =>
      (await call("bot_deliver", { order_id: orderId, views: d.views, likes: d.likes, dislikes: d.dislikes, subscribers: d.subscribers })) ?? null,
    delivered: (orderId, d, giveUp = false) =>
      call("bot_order_delivered", {
        order_id: orderId,
        views: d.views,
        likes: d.likes,
        dislikes: d.dislikes,
        comments: d.comments,
        subscribers: d.subscribers,
        give_up: giveUp,
      }),
    liveTargets: async () => (await call("bot_live_targets", {})) ?? [],
    grow: async (n) => Number(await call("bot_grow", { n })) || 0,
    pool: async () => Number(await call("bot_pool", {})) || 0,
    postComment: async (videoId, body) => String(await call("bot_post_comment", { video_id: videoId, body })),
    likeComments: (videoId, n) => call("bot_like_comments", { video_id: videoId, n }),
    recentComments: async (videoId) => ((await call("bot_recent_comments", { video_id: videoId })) ?? []).map((r) => r.body),
    chat: (videoId, body) => call("bot_chat", { video_id: videoId, body }),
    presence: (videoId, n) => call("bot_presence", { video_id: videoId, n }),
  };
}

/**
 * Each video's caption cues, read from storage once per hour. A video without
 * captions is looked at again after a few minutes: a new upload gets them a
 * little after it is ready.
 */
export function createCueCache(storage, { now = Date.now, ttlMs = 60 * 60 * 1000, missingTtlMs = 5 * 60 * 1000 } = {}) {
  const cache = new Map();
  return async function cuesFor(video) {
    const hit = cache.get(video.id);
    if (hit && now() - hit.at < (hit.cues.length ? ttlMs : missingTtlMs)) return hit.cues;
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

/** How far through its window an order is: 0 at the start, 1 at the end (and at once for "right away"). */
export function orderShare(order, now) {
  const start = Date.parse(order.starts_at);
  const end = Date.parse(order.ends_at);
  if (!(end > start)) return 1;
  return Math.min(1, Math.max(0, (now - start) / (end - start)));
}

/** What an order should get this round: its share of each amount so far, minus what it already got (comments within ROUND_CAP). */
export function orderDue(order, now) {
  const share = orderShare(order, now);
  const due = {};
  for (const k of KINDS) {
    const total = Math.max(0, Number(order[k]) || 0);
    const target = share >= 1 ? total : Math.min(total, Math.ceil(total * share));
    due[k] = Math.max(0, target - (Number(order[`done_${k}`]) || 0));
  }
  due.comments = Math.min(due.comments, ROUND_CAP.comments);
  return { share, due };
}

/**
 * Comments come from bots that have not commented on the video lately: when
 * every bot has, the pool grows by GROW_BY, up to POOL_MAX. Answers false when
 * it cannot grow any more.
 */
async function growPool(db, state) {
  if (state.full) return false;
  const before = state.size ?? (await db.pool());
  if (before >= POOL_MAX) {
    state.full = true;
    return false;
  }
  const after = await db.grow(GROW_BY);
  state.size = after;
  if (after <= before) state.full = true;
  return after > before;
}

/** Delivers one order's share for this round. Answers what it delivered. */
async function deliverOrder(o, { db, cuesFor, log, now, rand, pool }) {
  const { share, due } = orderDue(o, now());
  const got = { views: 0, likes: 0, dislikes: 0, comments: 0, subscribers: 0 };
  let stuck = false;

  // Views, likes, dislikes and subscribers: any number at once, in the database (bot_deliver, 035).
  if (o.video_id && broadcastState(o, now()) === "upcoming") due.views = 0;
  if (due.views || due.likes || due.dislikes || due.subscribers) {
    const added = await db.deliver(o.id, due);
    if (added) for (const k of ["views", "likes", "dislikes", "subscribers"]) got[k] = Number(added[k]) || 0;
  }

  if (due.comments > 0) {
    const cues = o.comments_mode === "on" ? await cuesFor({ id: o.video_id, hls_key: o.hls_key }) : [];
    const said = new Set(o.comments_mode === "on" ? (await db.recentComments(o.video_id)).map((b) => String(b).toLowerCase()) : []);
    let result = o.comments_mode === "on" ? "" : "closed";
    while (got.comments < due.comments && result !== "closed") {
      result = "duplicate";
      for (let tries = 0; tries < COMMENT_TRIES && result === "duplicate"; tries++) {
        const body = makeComment({ title: o.title, description: o.description, cues, now: now(), rand });
        if (!body || said.has(body.toLowerCase())) continue;
        result = await db.postComment(o.video_id, body);
        said.add(body.toLowerCase());
      }
      if (result === "posted") got.comments++;
      else if (result === "no_bot") {
        if (await growPool(db, pool)) continue;
        stuck = true;
        break;
      } else break;
    }
    const longPast = share >= 1 && now() - (Date.parse(o.ends_at) || 0) >= COMMENTS_GIVE_UP_AFTER_MS;
    if (result === "closed" || (result === "duplicate" && longPast)) {
      // Comments are off or held on the video, or there is nothing new left to
      // say about it: the rest of its comments are skipped, so the order can finish.
      log("bots", { order: String(o.id).slice(0, 8) }, result === "closed" ? "comments are not on for this video, its comments are skipped" : "nothing new to say about this video, the rest of its comments are skipped");
      got.comments = Math.max(due.comments, (Number(o.comments) || 0) - (Number(o.done_comments) || 0));
    }
    if (got.comments > 0 && result !== "closed" && rand() < 0.5) await db.likeComments(o.video_id, 1 + Math.floor(rand() * 3));
  }

  // Out of bot accounts for comments at the end of the window: the rest cannot be written.
  const giveUp = stuck && share >= 1;
  if (got.comments > 0 || giveUp) await db.delivered(o.id, { views: 0, likes: 0, dislikes: 0, comments: got.comments, subscribers: 0 }, giveUp);
  return got;
}

/**
 * The order round: every order the owner placed in the studio gets its share
 * so far. An order whose video went private, was deleted or was removed stops.
 */
export async function orderRound({ db, cuesFor, log, now = Date.now, rand = Math.random }) {
  const orders = await db.dueOrders();
  const total = { orders: orders.length, views: 0, likes: 0, dislikes: 0, comments: 0, subscribers: 0 };
  const pool = {};
  for (const o of orders) {
    const id = { order: String(o.id).slice(0, 8) };
    if (o.usable === false) {
      await db.delivered(o.id, { views: 0, likes: 0, dislikes: 0, comments: 0, subscribers: 0 }, true);
      log("bots", id, "the video can no longer take bots (private, deleted or removed), order stopped");
      continue;
    }
    try {
      const got = await deliverOrder(o, { db, cuesFor, log, now, rand, pool });
      for (const k of KINDS) total[k] += got[k];
    } catch (err) {
      log("bots", id, `order failed this round: ${err.message}`);
    }
  }
  // Every 5 seconds: only a round that added something is worth a log line.
  if (KINDS.some((k) => total[k] > 0)) log("bots", total, "orders round done");
  return total;
}

/**
 * The fast round, while a broadcast the owner switched bots on for is on (or
 * starts within 15 minutes): bot viewers, and a few chat lines about what is
 * on screen. Answers whether any broadcast was near, so the caller can slow down.
 */
export async function liveRound({ db, cuesFor, now = Date.now, rand = Math.random, videos }) {
  const list = videos ?? (await db.liveTargets());
  if (!list.length) return false;
  const settings = await db.settings();
  if (!settings) return false;
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
  let lastTargets = { at: -Infinity, list: [] };
  let lastLive = -Infinity;
  let near = false;
  log("bots", {}, "bots ready (they deliver what is ordered in the studio's Bots page, while the bots flag is not off)");
  while (!stopSignal?.aborted) {
    try {
      if (await db.on()) {
        await orderRound({ db, cuesFor, log, now });
        if (now() - lastTargets.at >= 60 * 1000) lastTargets = { at: now(), list: await db.liveTargets() };
        if (now() - lastLive >= (near ? BOTS_LIVE_EVERY_MS : 60 * 1000)) {
          lastLive = now();
          near = await liveRound({ db, cuesFor, now, videos: lastTargets.list });
        }
      }
    } catch (err) {
      log("bots", {}, `round failed: ${err.message}`);
    }
    await sleep(BOTS_EVERY_MS, stopSignal);
  }
}
