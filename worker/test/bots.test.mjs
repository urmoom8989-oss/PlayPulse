// The channel bots: what they say, and the rounds against a fake database.
import assert from "node:assert/strict";
import { test } from "node:test";
import { ageFactor, around, broadcastState, liveRound, slowRound } from "../lib/bots.mjs";
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

test("numbers: age, randomness and broadcast state", () => {
  const now = Date.UTC(2026, 10, 9);
  assert.equal(ageFactor(new Date(now - 3600_000).toISOString(), now), 1);
  assert.ok(ageFactor(new Date(now - 7 * 86400_000).toISOString(), now) < 0.4);
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

function fakeDb(videos) {
  const calls = [];
  const rec = (name) => async (...args) => {
    calls.push([name, ...args]);
    return name === "comment" ? "c-id" : name === "recentComments" ? [] : 1;
  };
  return {
    calls,
    settings: async () => ({ views_per_day: 14400, like_rate: 0.05, dislike_rate: 0.01, comment_rate: 0.05, subscribers_per_day: 1440, live_viewers_min: 20, live_viewers_max: 40, chat_per_minute: 8 }),
    targets: async () => videos,
    addViews: rec("addViews"),
    react: rec("react"),
    subscribe: rec("subscribe"),
    comment: rec("comment"),
    likeComments: rec("likeComments"),
    recentComments: rec("recentComments"),
    chat: rec("chat"),
    presence: rec("presence"),
  };
}

test("the slow round adds views, reactions, comments and subscribers, never to an upcoming broadcast", async () => {
  const now = Date.UTC(2026, 10, 9);
  const videos = [
    { id: "v1", title: "Minecraft speedrun", description: "", published_at: new Date(now - 3600_000).toISOString(), comments_mode: "on", duration_s: 300, broadcast_at: null },
    { id: "v2", title: "Premiere", description: "", published_at: new Date(now).toISOString(), comments_mode: "on", duration_s: 300, broadcast_at: new Date(now + 3600_000).toISOString() },
  ];
  const db = fakeDb(videos);
  const result = await slowRound({ db, cuesFor: async () => parseVtt(VTT), log: () => {}, now: () => now, rand: seeded(11) });
  const touched = new Set(db.calls.filter((c) => c[0] === "addViews").map((c) => c[1]));
  assert.deepEqual([...touched], ["v1"]);
  assert.ok(result.views > 50, String(result.views));
  assert.ok(db.calls.some((c) => c[0] === "react" && c[1] === "v1"));
  assert.ok(db.calls.some((c) => c[0] === "comment" && c[1] === "v1"));
  assert.ok(db.calls.some((c) => c[0] === "subscribe"));
});

test("the live round fills the chat and the viewer count while a broadcast is on", async () => {
  const now = Date.UTC(2026, 10, 9);
  const live = { id: "v3", title: "Live", published_at: new Date(now - 60_000).toISOString(), duration_s: 600, broadcast_at: new Date(now - 60_000).toISOString() };
  const ended = { id: "v4", title: "Old", published_at: new Date(now - 86400_000).toISOString(), duration_s: 60, broadcast_at: new Date(now - 86400_000).toISOString() };
  const db = fakeDb([live, ended]);
  const near = await liveRound({ db, cuesFor: async () => parseVtt(VTT), now: () => now, rand: seeded(5) });
  assert.equal(near, true);
  const presence = db.calls.filter((c) => c[0] === "presence");
  assert.equal(presence.length, 1);
  assert.equal(presence[0][1], "v3");
  assert.ok(presence[0][2] >= 20 && presence[0][2] <= 40);
  assert.ok(db.calls.every((c) => c[1] !== "v4"));
  assert.equal(await liveRound({ db: fakeDb([ended]), cuesFor: async () => [], now: () => now }), false);
});
