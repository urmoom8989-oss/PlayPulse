// Channel bots (030_bots.sql, 034_bot_panel.sql): for channels with bots_on
// (@typicalgamer), only what the owner orders in the studio's Bots page.
// Each order (views, likes, dislikes, comments that react to moments in the
// video's captions, subscribers) is delivered a little every minute, spread
// over the window the owner picked; and during the Premieres and live
// broadcasts the owner switched bots on for, viewers and live chat. Runs
// beside the encode loop, whatever it is doing, while the bots flag is not off.
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

/** Orders get their next share this often. */
export const BOTS_EVERY_MS = 60 * 1000;
/** The fast round (live viewers and chat) runs this often while a broadcast is on or near. */
export const BOTS_LIVE_EVERY_MS = 15 * 1000;
/** The most of each kind one order gets in one round, so a big "right away" order cannot hog the database. */
export const ROUND_CAP = { views: 10000, reactions: 600, comments: 10, subscribers: 1000 };
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
    addViews: (videoId, n) => call("bot_add_views", { video_id: videoId, n }),
    react: async (videoId, likes, dislikes) => Number(await call("bot_react", { video_id: videoId, likes, dislikes })) || 0,
    subscribeTo: async (channelId, n) => Number(await call("bot_subscribe_to", { channel_id: channelId, n })) || 0,
    grow: async (n) => Number(await call("bot_grow", { n })) || 0,
    pool: async () => Number(await call("bot_pool", {})) || 0,
    postComment: async (videoId, body) => String(await call("bot_post_comment", { video_id: videoId, body })),
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

/** How far through its window an order is: 0 at the start, 1 at the end (and at once for "right away"). */
export function orderShare(order, now) {
  const start = Date.parse(order.starts_at);
  const end = Date.parse(order.ends_at);
  if (!(end > start)) return 1;
  return Math.min(1, Math.max(0, (now - start) / (end - start)));
}

/**
 * What an order should get this round: its share of each amount so far,
 * minus what it already got, within ROUND_CAP (likes and dislikes share the
 * reactions cap, in proportion).
 */
export function orderDue(order, now) {
  const share = orderShare(order, now);
  const due = {};
  for (const k of KINDS) {
    const total = Math.max(0, Number(order[k]) || 0);
    const target = share >= 1 ? total : Math.min(total, Math.ceil(total * share));
    due[k] = Math.max(0, target - (Number(order[`done_${k}`]) || 0));
  }
  due.views = Math.min(due.views, ROUND_CAP.views);
  const reactions = due.likes + due.dislikes;
  if (reactions > ROUND_CAP.reactions) {
    const likes = Math.round((ROUND_CAP.reactions * due.likes) / reactions);
    due.likes = likes;
    due.dislikes = ROUND_CAP.reactions - likes;
  }
  due.comments = Math.min(due.comments, ROUND_CAP.comments);
  due.subscribers = Math.min(due.subscribers, ROUND_CAP.subscribers);
  return { share, due };
}

const nothing = (d) => KINDS.every((k) => !d[k]);

/**
 * One bot account per like, dislike and subscription: when the pool runs dry
 * it grows by GROW_BY, up to POOL_MAX. Answers false when it cannot grow.
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

  // A Premiere or live broadcast that has not started gets no views yet.
  if (o.video_id && broadcastState(o, now()) === "upcoming") due.views = 0;
  for (let left = due.views; left > 0; ) {
    const n = Math.min(2000, left);
    await db.addViews(o.video_id, n);
    got.views += n;
    left -= n;
  }

  // Likes and dislikes, 300 a call (bot_react), each from a bot that has not reacted yet.
  let likes = due.likes;
  let dislikes = due.dislikes;
  while (likes + dislikes > 0) {
    const askLikes = Math.min(likes, 300);
    const askDislikes = Math.min(dislikes, 300 - askLikes);
    const made = await db.react(o.video_id, askLikes, askDislikes);
    const madeLikes = Math.min(made, askLikes);
    const madeDislikes = Math.max(0, made - askLikes);
    got.likes += madeLikes;
    got.dislikes += madeDislikes;
    likes -= madeLikes;
    dislikes -= madeDislikes;
    if (made < askLikes + askDislikes && !(await growPool(db, pool))) {
      stuck = true;
      break;
    }
  }

  if (due.comments > 0) {
    const cues = o.comments_mode === "on" ? await cuesFor({ id: o.video_id, hls_key: o.hls_key }) : [];
    const said = new Set(o.comments_mode === "on" ? (await db.recentComments(o.video_id)).map((b) => String(b).toLowerCase()) : []);
    let result = o.comments_mode === "on" ? "" : "closed";
    while (got.comments < due.comments && result !== "closed") {
      result = "duplicate";
      for (let tries = 0; tries < 8 && result === "duplicate"; tries++) {
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
    if (result === "closed" || (result === "duplicate" && share >= 1)) {
      // Comments are off or held on the video, or there is nothing new left to
      // say about it: the rest of its comments are skipped, so the order can finish.
      log("bots", { order: String(o.id).slice(0, 8) }, result === "closed" ? "comments are not on for this video, its comments are skipped" : "nothing new to say about this video, the rest of its comments are skipped");
      got.comments = due.comments;
    }
    if (got.comments > 0 && result !== "closed" && rand() < 0.5) await db.likeComments(o.video_id, 1 + Math.floor(rand() * 3));
  }

  for (let left = due.subscribers; left > 0; ) {
    const ask = Math.min(500, left);
    const made = await db.subscribeTo(o.channel_id, ask);
    got.subscribers += made;
    left -= made;
    if (made < ask && !(await growPool(db, pool))) {
      stuck = true;
      break;
    }
  }

  // Out of bot accounts at the end of the window: what is left cannot be delivered.
  const giveUp = stuck && share >= 1;
  if (!nothing(got) || giveUp) await db.delivered(o.id, got, giveUp);
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
  if (orders.length) log("bots", total, "orders round done");
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
  let lastOrders = -Infinity;
  let lastTargets = { at: -Infinity, list: [] };
  log("bots", {}, "bots ready (they deliver what is ordered in the studio's Bots page, while the bots flag is not off)");
  while (!stopSignal?.aborted) {
    let near = false;
    try {
      if (await db.on()) {
        if (now() - lastOrders >= BOTS_EVERY_MS) {
          lastOrders = now();
          await orderRound({ db, cuesFor, log, now });
        }
        if (now() - lastTargets.at >= 60 * 1000) lastTargets = { at: now(), list: await db.liveTargets() };
        near = await liveRound({ db, cuesFor, now, videos: lastTargets.list });
      }
    } catch (err) {
      log("bots", {}, `round failed: ${err.message}`);
    }
    await sleep(near ? BOTS_LIVE_EVERY_MS : BOTS_EVERY_MS, stopSignal);
  }
}
