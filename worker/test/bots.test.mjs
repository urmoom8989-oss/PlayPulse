// The channel bots: what they say, and the rounds against a fake database.
import assert from "node:assert/strict";
import { test } from "node:test";
import { GROW_BY, POOL_MAX, ROUND_CAP, around, broadcastState, liveRound, orderDue, orderRound, orderShare } from "../lib/bots.mjs";
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

/** A database that records every call. pool: how many bot accounts there are (one reaction each per video). */
function fakeDb({ orders = [], live = [], pool = 300, commentsAnswer = "posted" } = {}) {
  const calls = [];
  const state = { pool, reacted: new Map(), subscribed: 0, delivered: [] };
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
    delivered: rec("delivered", (id, d, giveUp) => {
      state.delivered.push({ id, ...d, giveUp });
      return "active";
    }),
    addViews: rec("addViews", 1),
    react: rec("react", (video, likes, dislikes) => {
      const had = state.reacted.get(video) ?? 0;
      const made = Math.min(likes + dislikes, 300, state.pool - had);
      state.reacted.set(video, had + made);
      return made;
    }),
    subscribeTo: rec("subscribeTo", (channel, n) => {
      const made = Math.min(n, 500, state.pool - state.subscribed);
      state.subscribed += made;
      return made;
    }),
    grow: rec("grow", (n) => (state.pool = Math.min(POOL_MAX, state.pool + Math.min(n, GROW_BY)))),
    pool: rec("pool", () => state.pool),
    postComment: rec("postComment", commentsAnswer),
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

test("an order is spread over its window, and right away means right away", () => {
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
  const now0 = order(now, { views: 500, comments: 3 });
  assert.equal(orderShare(now0, now), 1);
  assert.deepEqual(orderDue(now0, now).due, { views: 500, likes: 0, dislikes: 0, comments: 3, subscribers: 0 });
  // Big orders go in pieces, a round at a time.
  const big = orderDue(order(now, { views: 1_000_000, likes: 9000, dislikes: 1000, comments: 500, subscribers: 5000 }), now).due;
  assert.equal(big.views, ROUND_CAP.views);
  assert.equal(big.likes + big.dislikes, ROUND_CAP.reactions);
  assert.equal(big.likes, 540);
  assert.equal(big.comments, ROUND_CAP.comments);
  assert.equal(big.subscribers, ROUND_CAP.subscribers);
});

test("the order round delivers what is due and records it; nothing is added without an order", async () => {
  const now = Date.UTC(2026, 10, 9, 12);
  const empty = fakeDb();
  const none = await orderRound({ db: empty, cuesFor: async () => [], log: () => {}, now: () => now });
  assert.equal(none.orders, 0);
  assert.deepEqual(empty.calls, []);

  const db = fakeDb({ orders: [order(now, { views: 2500, likes: 50, dislikes: 2, comments: 3, subscribers: 20 })] });
  const total = await orderRound({ db, cuesFor: async () => parseVtt(VTT), log: () => {}, now: () => now, rand: seeded(3) });
  assert.equal(total.views, 2500);
  assert.deepEqual(db.calls.filter((c) => c[0] === "addViews").map((c) => c[2]), [2000, 500]);
  assert.deepEqual(db.calls.find((c) => c[0] === "react").slice(1), ["v1", 50, 2]);
  assert.equal(db.calls.filter((c) => c[0] === "postComment").length, 3);
  assert.deepEqual(db.calls.find((c) => c[0] === "subscribeTo").slice(1), ["ch1", 20]);
  assert.deepEqual(db.state.delivered, [{ id: "o1", views: 2500, likes: 50, dislikes: 2, comments: 3, subscribers: 20, giveUp: false }]);
});

test("when the bots run out, the pool grows; at its limit the rest is dropped at the end of the window", async () => {
  const now = Date.UTC(2026, 10, 9, 12);
  const db = fakeDb({ orders: [order(now, { likes: 500, subscribers: 400 })], pool: 300 });
  await orderRound({ db, cuesFor: async () => [], log: () => {}, now: () => now });
  assert.ok(db.calls.some((c) => c[0] === "grow"));
  assert.equal(db.state.delivered[0].likes, 500);
  assert.equal(db.state.delivered[0].subscribers, 400);
  assert.equal(db.state.delivered[0].giveUp, false);

  const full = fakeDb({ orders: [order(now, { likes: 600 })], pool: POOL_MAX - 100 });
  full.state.reacted.set("v1", POOL_MAX - 100);
  await orderRound({ db: full, cuesFor: async () => [], log: () => {}, now: () => now });
  // The last 100 accounts are made and used, then there are no more.
  assert.equal(full.state.pool, POOL_MAX);
  assert.equal(full.state.delivered[0].likes, 100);
  assert.equal(full.state.delivered[0].giveUp, true);
});

test("stopped and skipped: a video that went private, comments that are off, a Premiere not started", async () => {
  const now = Date.UTC(2026, 10, 9, 12);
  const gone = fakeDb({ orders: [order(now, { views: 10, usable: false })] });
  const lines = [];
  await orderRound({ db: gone, cuesFor: async () => [], log: (...a) => lines.push(a.join(" ")), now: () => now });
  assert.deepEqual(gone.state.delivered, [{ id: "o1", views: 0, likes: 0, dislikes: 0, comments: 0, subscribers: 0, giveUp: true }]);
  assert.ok(lines.some((l) => /order stopped/.test(l)));
  assert.ok(!gone.calls.some((c) => c[0] === "addViews"));

  const off = fakeDb({ orders: [order(now, { comments: 5, comments_mode: "off" })] });
  await orderRound({ db: off, cuesFor: async () => [], log: () => {}, now: () => now });
  assert.ok(!off.calls.some((c) => c[0] === "postComment"));
  assert.equal(off.state.delivered[0].comments, 5);

  const premiere = fakeDb({ orders: [order(now, { views: 100, likes: 5, broadcast_at: at(now + 3600_000) })] });
  await orderRound({ db: premiere, cuesFor: async () => [], log: () => {}, now: () => now });
  assert.ok(!premiere.calls.some((c) => c[0] === "addViews"));
  assert.equal(premiere.state.delivered[0].likes, 5);
});

test("nothing new to say: comments wait for the next round, and are dropped at the end of the window", async () => {
  const now = Date.UTC(2026, 10, 9, 12);
  const spread = order(now, { comments: 4, starts_at: at(now - 3600_000), ends_at: at(now + 3600_000) });
  const db = fakeDb({ orders: [spread], commentsAnswer: "duplicate" });
  await orderRound({ db, cuesFor: async () => [], log: () => {}, now: () => now });
  assert.equal(db.state.delivered.length, 0);
  const end = fakeDb({ orders: [order(now, { comments: 4 })], commentsAnswer: "duplicate" });
  await orderRound({ db: end, cuesFor: async () => [], log: () => {}, now: () => now });
  assert.equal(end.state.delivered[0].comments, 4);
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
