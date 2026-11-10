// Cards (041): the rules the uploader, the studio and the player share.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  CARDS_MAX,
  cardErrorText,
  cardProblem,
  cardTeaser,
  cardsDue,
  draftFrom,
  emptyCard,
  formatStart,
  handleFrom,
  linkFrom,
  parseStart,
  readCard,
  toPayload,
  videoIdFrom,
} from "../lib/cards/rules.ts";

const ID = "5e6f7a8b-1111-4222-8333-944455556666";

test("times: m:ss, h:mm:ss or seconds, and back", () => {
  assert.equal(parseStart(""), 0);
  assert.equal(parseStart("1:30"), 90);
  assert.equal(parseStart("75"), 75);
  assert.equal(parseStart("1:02:03"), 3723);
  for (const bad of ["1:75", "abc", "1:2", "-5", "1:61:00"]) assert.equal(parseStart(bad), null, bad);
  assert.equal(formatStart(90), "1:30");
  assert.equal(formatStart(3723), "1:02:03");
});

test("what each kind of card points at", () => {
  assert.equal(videoIdFrom(`https://sloptube.example/watch?v=${ID}&t=5s`), ID);
  assert.equal(videoIdFrom(`/shorts/${ID.toUpperCase()}`), ID);
  assert.equal(videoIdFrom("not a video"), null);
  assert.equal(handleFrom("@TypicalGamer"), "typicalgamer");
  assert.equal(handleFrom("https://sloptube.example/@thatguyzan/videos"), "thatguyzan");
  assert.equal(handleFrom("a b"), null);
  assert.equal(linkFrom("example.com/shop"), "https://example.com/shop");
  assert.equal(linkFrom("http://example.com"), "http://example.com/");
  for (const bad of ["javascript:alert(1)", "localhost", "two words.com", "ftp://example.com"]) assert.equal(linkFrom(bad), null, bad);
});

test("a card's problems, and the payload for set_video_cards", () => {
  assert.equal(cardProblem({ kind: "video", target: "", message: "", start: "0:00" }), "Choose a video");
  // The list gives the video's id; a pasted link from before still works.
  assert.equal(cardProblem({ kind: "video", target: ID, message: "", start: "0:00" }), null);
  assert.equal(cardProblem({ kind: "link", target: "example.com", message: "x".repeat(31), start: "0:00" }), "Up to 30 characters");
  assert.equal(cardProblem({ kind: "channel", target: "@bob", message: "", start: "9:99" }), "Use a time like 1:30");
  assert.equal(cardProblem({ kind: "channel", target: "@bob", message: "", start: "5:00" }, 120), "That is after the video ends");
  const ok = toPayload([
    { kind: "video", target: `/watch?v=${ID}`, message: " Watch next ", start: "0:12" },
    { kind: "channel", target: "@Bob", message: "", start: "" },
    { kind: "link", target: "example.com", message: "Merch", start: "45" },
  ]);
  assert.deepEqual(ok, {
    cards: [
      { kind: "video", video_id: ID, message: "Watch next", start_s: 12 },
      { kind: "channel", handle: "bob", message: "", start_s: 0 },
      { kind: "link", url: "https://example.com/", message: "Merch", start_s: 45 },
    ],
  });
  assert.deepEqual(toPayload([emptyCard(), { kind: "link", target: "x", message: "", start: "0" }]), { error: "Choose a video", index: 0 });
  assert.equal("error" in toPayload(Array.from({ length: CARDS_MAX + 1 }, () => emptyCard("channel"))), true);
});

test("cards from the database, back in the editor, and on the player", () => {
  const rows = [
    { id: "c1", kind: "video", message: "", start_s: 12, url: null, target_video_id: ID, video_title: "Part 2", video_thumbnail_url: null, video_duration_s: "61.5", video_views: "1200", video_channel_name: "Bob" },
    { id: "c2", kind: "channel", message: "Go sub", start_s: 30, url: null, channel_handle: "bob", channel_name: "Bob", channel_avatar_url: null, channel_subscribers: 7 },
    { id: "c3", kind: "link", message: "", start_s: 45, url: "https://www.example.com/shop" },
    { id: "c4", kind: "video", message: "", start_s: 50, url: null, target_video_id: null },
  ];
  const cards = rows.map(readCard).filter(Boolean);
  assert.equal(cards.length, 3, "a video card whose video is gone is left out");
  assert.equal(cards[0].video.durationS, 61.5);
  assert.deepEqual(cards.map(draftFrom), [
    { kind: "video", target: ID, message: "", start: "0:12", label: "Part 2" },
    { kind: "channel", target: "@bob", message: "Go sub", start: "0:30" },
    { kind: "link", target: "https://www.example.com/shop", message: "", start: "0:45" },
  ]);
  assert.deepEqual(cards.map(cardTeaser), ["Part 2", "Go sub", "example.com"]);
  assert.deepEqual(cardsDue(cards, 31).map((c) => c.id), ["c1", "c2"]);
  assert.match(cardErrorText("channel_not_found"), /channels can't be found/);
});

test("041: cards are the owner's to change, anyone who can watch reads them", () => {
  const sql = readFileSync(new URL("../supabase/migrations/041_cards.sql", import.meta.url), "utf8");
  assert.match(sql, /create table if not exists public\.video_cards/);
  assert.match(sql, /alter table public\.video_cards enable row level security/);
  assert.match(sql, /char_length\(message\) <= 30/);
  assert.match(sql, /jsonb_array_length\(set_video_cards\.cards\) > 5/);
  assert.match(sql, /raise exception 'not_owner'/);
  assert.match(sql, /grant execute on function public\.video_cards_for\(uuid\) to anon, authenticated, service_role/);
  assert.match(sql, /revoke execute on function public\.set_video_cards\(uuid, jsonb\) from public, anon/);
  assert.match(sql, /'video_cards',/);
});

test("the time slider's values: whole seconds along the video, shown as m:ss", () => {
  // The slider sets "start" with formatStart and reads it back with parseStart.
  for (const s of [0, 1, 59, 60, 61, 599, 3599, 3600, 4000]) assert.equal(parseStart(formatStart(s)), s);
});
