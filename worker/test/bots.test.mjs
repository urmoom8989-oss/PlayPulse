// The channel bots: what they say, and the rounds against a fake database.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  COMMENTS_GIVE_UP_AFTER_MS,
  GROW_BY,
  POOL_MAX,
  ROUND_CAP,
  around,
  broadcastState,
  createCueCache,
  liveRound,
  orderDue,
  orderRound,
  orderShare,
} from "../lib/bots.mjs";
import { chaptersOf, keywords, makeChatLine, makeComment, parseVtt, quoteOf, stamp } from "../lib/bottext.mjs";

/** A repeatable random source. */
function seeded(seed = 1) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const VTT = `WEBVTT

00:00:01.000 --> 00:00:04.000
okay chat we are doing the speedrun today

00:01:05.500 --> 00:01:08.000
<c>no way</c> he just jumped
off the castle wall

01:02:03.000 --> 01:02:05.000
gg`;

test("captions are read as cues with start times and plain text", () => {
  const cues = parseVtt(VTT);
  assert.equal(cues.length, 3);
  assert.deepEqual(cues[1], { start: 65.5, end: 68, text: "no way he just jumped off the castle wall" });
  assert.equal(cues[2].start, 3723);
  assert.equal(stamp(65.5), "1:05");
  assert.equal(stamp(3723), "1:02:03");
  assert.equal(quoteOf("no way he just jumped off the castle wall!", 20), "no way he");
  assert.equal(quoteOf("gg wp everyone!", 60), "gg wp everyone");
});

test("chapters and title words", () => {
  assert.deepEqual(chaptersOf("intro\n0:00 Intro\n1:05 - The jump\n[2:30] Boss fight"), [
    { start: 0, title: "Intro" },
    { start: 65, title: "The jump" },
    { start: 150, title: "Boss fight" },
  ]);
  assert.deepEqual(keywords("Minecraft SPEEDRUN world record (part 2)").slice(0, 2), ["minecraft", "speedrun"]);
});

test("comments are short, varied, and mostly about real moments", () => {
  const rand = seeded(42);
  const cues = parseVtt(VTT);
  const out = Array.from({ length: 300 }, () => makeComment({ title: "Minecraft speedrun world record", description: "0:00 Intro\n1:05 The jump", cues, now: Date.UTC(2026, 10, 9), rand }));
  assert.ok(out.every((c) => c.length > 0 && c.length <= 200));
  assert.ok(new Set(out).size > 60, "plenty of different comments");
  assert.ok(out.filter((c) => /\d:\d{2}/.test(c) || /"/.test(c)).length > 100, "many point at a moment or quote one");
  assert.ok(out.some((c) => /castle|speedrun|jumped/i.test(c)));
  assert.ok(!out.some((c) => c.includes("undefined")));
  // Without captions there are still comments.
  assert.ok(makeComment({ title: "", cues: [], rand: seeded(3) }).length > 0);
});

test("chat lines react to what was just said, or are the usual chat", () => {
  const rand = seeded(7);
  const cues = parseVtt(VTT);
  const lines = Array.from({ length: 100 }, () => makeChatLine({ cues, at: 67, rand }));
  assert.ok(lines.some((l) => /jumped|castle|no way/.test(l)));
  assert.ok(lines.every((l) => l.length > 0 && l.length <= 200));
});

test("numbers: randomness and broadcast state", () => {
  const now = Date.UTC(2026, 10, 9);
  assert.equal(around(0), 0);
  const rand = seeded(9);
  const avg = Array.from({ length: 2000 }, () => around(3, rand)).reduce((a, b) => a + b, 0) / 2000;
  assert.ok(Math.abs(avg - 3) < 0.3, String(avg));
  assert.ok(Math.abs(around(1000, seeded(5)) - 1000) < 150);
  const at = new Date(now).toISOString();
  assert.equal(broadcastState({ broadcast_at: at, duration_s: 60 }, now - 1), "upcoming");
  assert.equal(broadcastState({ broadcast_at: at, duration_s: 60 }, now + 1000), "live");
  assert.equal(broadcastState({ broadcast_at: at, duration_s: 60 }, now + 61_000), "ended");
  assert.equal(broadcastState({ broadcast_at: null }, now), null);
});

/** A database that records every call. pool: how many bot accounts there are (one comment each per video, lately). */
function fakeDb({ orders = [], live = [], pool = 300, commentsAnswer = "posted" } = {}) {
  const calls = [];
  const state = { pool, commented: 0, delivered: [], deliveredNow: [] };
  const rec = (name, answer) => async (...args) => {
    calls.push([name, ...args]);
    return typeof answer === "function" ? answer(...args) : answer;
  };
  return {
    calls,
    state,
    settings: async () => ({ live_viewers_min: 20, live_viewers_max: 40, chat_per_minute: 8 }),
    dueOrders: async () => orders,
    liveTargets: async () => live,
    // bot_deliver adds any number at once and answers what it added.
    deliver: rec("deliver", (id, d) => {
      state.deliveredNow.push({ id, ...d });
      return { views: d.views, likes: d.likes, dislikes: d.dislikes, subscribers: d.subscribers };
    }),
    delivered: rec("delivered", (id, d, giveUp) => {
      state.delivered.push({ id, ...d, giveUp });
      return "active";
    }),
    grow: rec("grow", (n) => (state.pool = Math.min(POOL_MAX, state.pool + Math.min(n, GROW_BY)))),
    pool: rec("pool", () => state.pool),
    postComment: rec("postComment", () => {
      if (commentsAnswer !== "posted") return commentsAnswer;
      if (state.commented >= state.pool) return "no_bot";
      state.commented++;
      return "posted";
    }),
    likeComments: rec("likeComments", 1),
    recentComments: rec("recentComments", []),
    chat: rec("chat", 1),
    presence: rec("presence", 1),
  };
}

const at = (ms) => new Date(ms).toISOString();
function order(now, extra = {}) {
  return {
    id: "o1",
    channel_id: "ch1",
    video_id: "v1",
    views: 0, likes: 0, dislikes: 0, comments: 0, subscribers: 0,
    done_views: 0, done_likes: 0, done_dislikes: 0, done_comments: 0, done_subscribers: 0,
    starts_at: at(now), ends_at: at(now), title: "Minecraft speedrun", description: "", duration_s: 300,
    hls_key: "hls/v1/master.m3u8", comments_mode: "on", broadcast_at: null, usable: true,
    ...extra,
  };
}

test("an order is spread over its window, and all at once means all at once", () => {
  const now = Date.UTC(2026, 10, 9, 12);
  const day = order(now, { starts_at: at(now - 6 * 3600_000), ends_at: at(now + 18 * 3600_000), views: 1000, likes: 40, subscribers: 10 });
  assert.equal(orderShare(day, now), 0.25);
  assert.deepEqual(orderDue(day, now).due, { views: 250, likes: 10, dislikes: 0, comments: 0, subscribers: 3 });
  // What was delivered already is not delivered again.
  assert.equal(orderDue({ ...day, done_views: 240 }, now).due.views, 10);
  assert.equal(orderDue({ ...day, done_views: 260 }, now).due.views, 0);
  // Before it starts nothing, after it ends the rest.
  assert.equal(orderShare(day, now - 7 * 3600_000), 0);
  assert.equal(orderDue(day, now + 19 * 3600_000).due.views, 1000);
  // No limit on the amounts; only comments go a round at a time.
  const big = orderDue(order(now, { views: 50_000_000, likes: 2_000_000, dislikes: 90_000, comments: 500, subscribers: 3_000_000 }), now).due;
  assert.deepEqual(big, { views: 50_000_000, likes: 2_000_000, dislikes: 90_000, comments: ROUND_CAP.comments, subscribers: 3_000_000 });
});

test("the order round adds what is due in one go and writes the comments; nothing without an order", async () => {
  const now = Date.UTC(2026, 10, 9, 12);
  const empty = fakeDb();
  const none = await orderRound({ db: empty, cuesFor: async () => [], log: () => {}, now: () => now });
  assert.equal(none.orders, 0);
  assert.deepEqual(empty.calls, []);

  const db = fakeDb({ orders: [order(now, { views: 2_500_000, likes: 50_000, dislikes: 2, comments: 3, subscribers: 20 })] });
  const total = await orderRound({ db, cuesFor: async () => parseVtt(VTT), log: () => {}, now: () => now, rand: seeded(3) });
  assert.equal(total.views, 2_500_000);
  assert.deepEqual(db.state.deliveredNow, [{ id: "o1", views: 2_500_000, likes: 50_000, dislikes: 2, comments: 3, subscribers: 20 }]);
  assert.equal(db.calls.filter((c) => c[0] === "postComment").length, 3);
  // Only the comments are recorded by the worker; bot_deliver records the rest itself.
  assert.deepEqual(db.state.delivered, [{ id: "o1", views: 0, likes: 0, dislikes: 0, comments: 3, subscribers: 0, giveUp: false }]);

  // An order with nothing due right now makes no calls.
  const spread = fakeDb({ orders: [order(now, { views: 10, starts_at: at(now), ends_at: at(now + 7 * 86400_000) })] });
  await orderRound({ db: spread, cuesFor: async () => [], log: () => {}, now: () => now });
  assert.ok(!spread.calls.some((c) => c[0] === "deliver" || c[0] === "delivered"));
});

test("comments: when every bot has commented the pool grows; at its limit the rest is dropped", async () => {
  const now = Date.UTC(2026, 10, 9, 12);
  const db = fakeDb({ orders: [order(now, { comments: 40 })], pool: 20 });
  await orderRound({ db, cuesFor: async () => parseVtt(VTT), log: () => {}, now: () => now, rand: seeded(4) });
  assert.ok(db.calls.some((c) => c[0] === "grow"));
  assert.equal(db.state.delivered[0].comments, 40);
  assert.equal(db.state.delivered[0].giveUp, false);

  const full = fakeDb({ orders: [order(now, { comments: 30 })], pool: POOL_MAX });
  full.state.commented = POOL_MAX - 10;
  await orderRound({ db: full, cuesFor: async () => parseVtt(VTT), log: () => {}, now: () => now, rand: seeded(4) });
  assert.equal(full.state.delivered[0].comments, 10);
  assert.equal(full.state.delivered[0].giveUp, true);
});

test("stopped and skipped: a video that went private, comments that are off, a Premiere not started", async () => {
  const now = Date.UTC(2026, 10, 9, 12);
  const gone = fakeDb({ orders: [order(now, { views: 10, usable: false })] });
  const lines = [];
  await orderRound({ db: gone, cuesFor: async () => [], log: (...a) => lines.push(a.join(" ")), now: () => now });
  assert.deepEqual(gone.state.delivered, [{ id: "o1", views: 0, likes: 0, dislikes: 0, comments: 0, subscribers: 0, giveUp: true }]);
  assert.ok(lines.some((l) => /order stopped/.test(l)));
  assert.ok(!gone.calls.some((c) => c[0] === "deliver"));

  const off = fakeDb({ orders: [order(now, { comments: 5000, comments_mode: "off" })] });
  await orderRound({ db: off, cuesFor: async () => [], log: () => {}, now: () => now });
  assert.ok(!off.calls.some((c) => c[0] === "postComment"));
  // All of them are skipped at once, not a round at a time.
  assert.equal(off.state.delivered[0].comments, 5000);

  const premiere = fakeDb({ orders: [order(now, { views: 100, likes: 5, broadcast_at: at(now + 3600_000) })] });
  await orderRound({ db: premiere, cuesFor: async () => [], log: () => {}, now: () => now });
  assert.equal(premiere.state.deliveredNow[0].views, 0);
  assert.equal(premiere.state.deliveredNow[0].likes, 5);
});

test("nothing new to say: comments wait, even for an all at once order, and are dropped 6 hours after the window", async () => {
  const now = Date.UTC(2026, 10, 9, 12);
  const spread = order(now, { comments: 4, starts_at: at(now - 3600_000), ends_at: at(now + 3600_000) });
  const db = fakeDb({ orders: [spread], commentsAnswer: "duplicate" });
  await orderRound({ db, cuesFor: async () => [], log: () => {}, now: () => now });
  assert.equal(db.state.delivered.length, 0);
  // All at once: not counted as written while there is still time to write them.
  const atOnce = fakeDb({ orders: [order(now, { comments: 400 })], commentsAnswer: "duplicate" });
  await orderRound({ db: atOnce, cuesFor: async () => [], log: () => {}, now: () => now });
  assert.equal(atOnce.state.delivered.length, 0);
  const later = now + COMMENTS_GIVE_UP_AFTER_MS;
  const end = fakeDb({ orders: [order(now, { comments: 400 })], commentsAnswer: "duplicate" });
  await orderRound({ db: end, cuesFor: async () => [], log: () => {}, now: () => later });
  assert.equal(end.state.delivered[0].comments, 400);
});

test("an order of 130 comments on a video without captions gets all 130, every one different", async () => {
  const now = Date.UTC(2026, 10, 9, 12);
  const o = order(now, { comments: 130, title: "my first vlog" });
  const db = fakeDb({ orders: [o] });
  const written = new Set();
  // Like bot_post_comment: the same text (any case) is refused.
  db.postComment = async (_video, body) => {
    const key = body.toLowerCase();
    if (written.has(key)) return "duplicate";
    written.add(key);
    return "posted";
  };
  const rand = seeded(7);
  for (let round = 0; round < 3; round++) {
    await orderRound({ db, cuesFor: async () => [], log: () => {}, now: () => now + round * 5000, rand });
    // What bot_order_delivered keeps track of.
    o.done_comments = written.size;
  }
  assert.equal(written.size, 130);
  assert.equal(db.state.delivered.reduce((n, d) => n + d.comments, 0), 130);
});

test("without captions there are thousands of different comments", () => {
  const rand = seeded(11);
  const out = Array.from({ length: 1000 }, () => makeComment({ title: "", cues: [], now: Date.UTC(2026, 10, 9), rand }).toLowerCase());
  assert.ok(new Set(out).size > 850, `only ${new Set(out).size} different`);
  assert.ok(!out.some((c) => c.includes("undefined") || c.includes("  ")));
});

test("a video without captions is looked at again after a few minutes", async () => {
  let t = 0;
  let reads = 0;
  let has = false;
  const storage = { getText: async () => (reads++, has ? "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nhello there friends\n" : null) };
  const cues = createCueCache(storage, { now: () => t });
  assert.deepEqual(await cues({ id: "v", hls_key: "hls/v/master.m3u8" }), []);
  has = true;
  t = 60_000;
  assert.deepEqual(await cues({ id: "v", hls_key: "hls/v/master.m3u8" }), []);
  t = 6 * 60_000;
  assert.equal((await cues({ id: "v", hls_key: "hls/v/master.m3u8" })).length, 1);
  const before = reads;
  t = 30 * 60_000;
  await cues({ id: "v", hls_key: "hls/v/master.m3u8" });
  assert.equal(reads, before, "captions found: kept for the hour");
});

test("the live round fills the chat and the viewer count while a broadcast is on", async () => {
  const now = Date.UTC(2026, 10, 9);
  const live = { id: "v3", title: "Live", duration_s: 600, broadcast_at: new Date(now - 60_000).toISOString() };
  const ended = { id: "v4", title: "Old", duration_s: 60, broadcast_at: new Date(now - 86400_000).toISOString() };
  const db = fakeDb({ live: [live, ended] });
  const near = await liveRound({ db, cuesFor: async () => parseVtt(VTT), now: () => now, rand: seeded(5) });
  assert.equal(near, true);
  const presence = db.calls.filter((c) => c[0] === "presence");
  assert.equal(presence.length, 1);
  assert.equal(presence[0][1], "v3");
  assert.ok(presence[0][2] >= 20 && presence[0][2] <= 40);
  assert.ok(db.calls.every((c) => c[1] !== "v4"));
  assert.equal(await liveRound({ db: fakeDb({ live: [ended] }), cuesFor: async () => [], now: () => now }), false);
  // Without any broadcast switched on, the live round does nothing at all.
  const quiet = fakeDb();
  assert.equal(await liveRound({ db: quiet, cuesFor: async () => [], now: () => now }), false);
  assert.deepEqual(quiet.calls, []);
});
