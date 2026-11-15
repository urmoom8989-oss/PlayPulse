// End screens (045): placing elements, what is checked before saving, when
// they show on the player, reading the rows, and the shape of the migration.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  END_MAX,
  END_SHOW_MAX,
  END_SHOW_MIN,
  END_SIZES,
  clampPlace,
  draftFromElement,
  elementProblem,
  elementsDue,
  endErrorText,
  endProblem,
  newElement,
  overlaps,
  readEndElement,
  toEndPayload,
} from "../lib/endscreens/rules.ts";

const r3 = (n) => Math.round(n * 1000) / 1000;

test("elements stay inside the player", () => {
  assert.deepEqual(clampPlace("video", -1, 2), { x: 0, y: r3(1 - END_SIZES.video.h) });
  assert.deepEqual(clampPlace("subscribe", 0.95, 0.5), { x: r3(1 - END_SIZES.subscribe.w), y: 0.5 });
  assert.deepEqual(clampPlace("channel", Number.NaN, Number.POSITIVE_INFINITY), { x: 0, y: 0 });
});

test("overlap is a real cover, not touching edges", () => {
  const a = { kind: "video", x: 0, y: 0 };
  assert.equal(overlaps(a, { kind: "video", x: 0.1, y: 0.1 }), true);
  assert.equal(overlaps(a, { kind: "video", x: END_SIZES.video.w, y: 0 }), false, "side by side");
  assert.equal(overlaps(a, { kind: "subscribe", x: 0.5, y: 0.5 }), false);
});

test("new elements go to the first free spot, at the full 20 seconds", () => {
  const first = newElement("video", []);
  const second = newElement("video", [first]);
  assert.equal(overlaps(first, second), false);
  assert.equal(first.showS, END_SHOW_MAX);
  const sub = newElement("subscribe", [first, second]);
  assert.equal(overlaps(sub, first) || overlaps(sub, second), false);
});

test("each element and the whole end screen are checked", () => {
  const v = newElement("video", []);
  assert.equal(elementProblem(v), "Pick a video.");
  assert.equal(elementProblem({ ...v, videoId: "x" }), null);
  const c = newElement("channel", []);
  assert.equal(elementProblem({ ...c, handle: "@a" }), "Enter a channel's @handle.");
  assert.equal(elementProblem({ ...c, handle: "@good_one" }), null);
  assert.equal(elementProblem({ ...v, videoId: "x", showS: END_SHOW_MIN - 1 }), "Pick 5 to 20 seconds.");
  assert.equal(elementProblem({ ...v, videoId: "x", showS: 7.5 }), "Pick 5 to 20 seconds.");

  const s1 = newElement("subscribe", []);
  assert.equal(endProblem([s1, { ...s1, y: 0.7 }]), "Only one subscribe element.");
  const vx = { ...v, videoId: "x" };
  assert.match(endProblem([vx, { ...vx }]) ?? "", /Elements 1 and 2 overlap/);
  const five = Array.from({ length: END_MAX + 1 }, (_, i) => ({ ...vx, x: 0, y: i * 0.01 }));
  assert.equal(endProblem(five), `Up to ${END_MAX} elements.`);
  assert.equal(endProblem([vx, newElement("subscribe", [vx])]), null);
});

test("the payload set_video_end_screen() takes", () => {
  assert.deepEqual(toEndPayload({ kind: "channel", videoId: "", handle: " @Someone ", x: 0.78, y: 0.06, showS: 10 }), {
    kind: "channel",
    handle: "Someone",
    x: 0.78,
    y: 0.06,
    show_s: 10,
  });
  assert.deepEqual(toEndPayload({ kind: "video", videoId: "v1", handle: "", x: 2, y: 0, showS: 20 }), {
    kind: "video",
    video_id: "v1",
    x: r3(1 - END_SIZES.video.w),
    y: 0,
    show_s: 20,
  });
  assert.deepEqual(Object.keys(toEndPayload(newElement("subscribe", []))).sort(), ["kind", "show_s", "x", "y"]);
});

test("each element shows for its own last seconds, and not once the video has ended", () => {
  const els = [
    { id: "a", showS: 20 },
    { id: "b", showS: 5 },
  ];
  assert.deepEqual(elementsDue(els, 79, 100), []);
  assert.deepEqual(elementsDue(els, 80, 100).map((e) => e.id), ["a"]);
  assert.deepEqual(elementsDue(els, 95, 100).map((e) => e.id), ["a", "b"]);
  assert.deepEqual(elementsDue(els, 100, 100), [], "ended: the end screen wall or Up next takes over");
  assert.deepEqual(elementsDue(els, 0, 0), [], "not before the length is known");
  assert.deepEqual(elementsDue(els, 2, 10).map((e) => e.id), ["a"], "a short video shows a 20 s element from the start");
});

const row = {
  id: "e1",
  kind: "video",
  x: 0.06,
  y: 0.34,
  show_s: 12,
  target_video_id: "v2",
  video_title: "Next one",
  video_thumbnail_url: null,
  video_hls_key: "videos/v2/hls",
  video_duration_s: "61.5",
  video_views: "1200",
  video_channel_name: "Chan",
  channel_id: null,
  channel_handle: null,
  channel_name: null,
  channel_avatar_url: null,
  channel_subscribers: null,
};

test("video_end_screen() rows become elements", () => {
  const v = readEndElement(row, null);
  assert.equal(v?.kind, "video");
  assert.equal(v?.showS, 12);
  assert.equal(v?.video?.id, "v2");
  assert.equal(v?.video?.durationS, 61.5);
  assert.equal(v?.video?.views, 1200);
  assert.equal(typeof v?.video?.thumbnail, "string");
  assert.equal(v?.channel, null);

  const sub = readEndElement(
    { ...row, id: "e2", kind: "subscribe", target_video_id: null, channel_id: "c1", channel_handle: "me", channel_name: "Me", channel_subscribers: 3 },
    null,
  );
  assert.equal(sub?.kind, "subscribe");
  assert.equal(sub?.channel?.handle, "me");
  assert.equal(sub?.video, null);

  assert.equal(readEndElement({ ...row, kind: "poll" }, null), null, "unknown kind");
  assert.equal(readEndElement({ ...row, target_video_id: null }, null), null, "a video element whose video is gone");
  assert.equal(readEndElement({ ...row, kind: "channel", channel_id: null }, null), null, "a channel element whose channel is gone");
  assert.equal(readEndElement({ ...row, show_s: 99 }, null)?.showS, END_SHOW_MAX, "clamped");
  assert.equal(readEndElement({ ...row, x: 5 }, null)?.x, r3(1 - END_SIZES.video.w), "kept inside");
});

test("an element read back edits as it was saved", () => {
  const ch = readEndElement(
    { ...row, kind: "channel", target_video_id: null, channel_id: "c9", channel_handle: "other", channel_name: "Other", x: 0.78, y: 0.66 },
    null,
  );
  assert.deepEqual(draftFromElement(ch), { kind: "channel", videoId: "", handle: "@other", x: 0.78, y: 0.66, showS: 12 });
});

test("every error code has words", () => {
  for (const code of ["too_many", "two_subscribes", "bad_place", "bad_time", "video_not_found", "channel_not_found", "not_owner", "off", "not_set_up"]) {
    assert.notEqual(endErrorText(code), endErrorText("whatever"), code);
  }
});

test("045 is re-runnable, has RLS, and ships the flag", () => {
  const sql = readFileSync(new URL("../supabase/migrations/045_end_screens.sql", import.meta.url), "utf8");
  assert.match(sql, /create table if not exists public\.end_screen_elements/);
  assert.match(sql, /alter table public\.end_screen_elements enable row level security/);
  assert.match(sql, /create or replace function public\.video_end_screen/);
  assert.match(sql, /create or replace function public\.set_video_end_screen/);
  assert.match(sql, /'end_screens'/);
  assert.match(sql, /on conflict \(key\) do nothing/);
  assert.doesNotMatch(sql, /—/, "no em dashes");
});
