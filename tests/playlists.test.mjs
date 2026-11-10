// Playlists (043): the rules the Save dialog, the playlist page and the watch
// page's panel share, and the shape of the migration.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  PLAYLIST_TITLE_MAX,
  headerFrom,
  hiddenText,
  isPlaylistVisibility,
  itemFrom,
  moveIn,
  nextInList,
  playlistErrorText,
  playlistHref,
  positionOf,
  savedToast,
  summaryFrom,
  titleProblem,
  videoCount,
  watchInList,
} from "../lib/playlists/rules.ts";

const L = "5e6f7a8b-1111-4222-8333-944455556666";
const ids = (xs) => xs.map((x) => x.id);
const list = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];

test("links: the playlist page and a video played from it", () => {
  assert.equal(playlistHref(L), `/playlist?list=${L}`);
  assert.equal(watchInList("v1", L), `/watch?v=v1&list=${L}`);
});

test("where a video is, and what plays after it", () => {
  assert.equal(positionOf(list, "a"), 1);
  assert.equal(positionOf(list, "d"), 4);
  assert.equal(positionOf(list, "zz"), 0);
  assert.equal(nextInList(list, "a")?.id, "b");
  assert.equal(nextInList(list, "c")?.id, "d");
  assert.equal(nextInList(list, "d"), null, "the last one stops");
  assert.equal(nextInList(list, "zz"), null, "a video not in the list does not jump into it");
});

test("moving works like move_playlist_video(): before an id, or to the end", () => {
  assert.deepEqual(ids(moveIn(list, "d", "a")), ["d", "a", "b", "c"]);
  assert.deepEqual(ids(moveIn(list, "a", null)), ["b", "c", "d", "a"]);
  assert.deepEqual(ids(moveIn(list, "a", "c")), ["b", "a", "c", "d"]);
  // Move down one: before the one after next.
  assert.deepEqual(ids(moveIn(list, "b", "d")), ["a", "c", "b", "d"]);
  assert.deepEqual(ids(moveIn(list, "b", "b")), ["a", "b", "c", "d"]);
  assert.deepEqual(ids(moveIn(list, "zz", "a")), ["a", "b", "c", "d"]);
  assert.deepEqual(ids(moveIn(list, "c", "gone")), ["a", "b", "d", "c"]);
});

test("names, counts and messages", () => {
  assert.equal(titleProblem(""), "Your playlist needs a name.");
  assert.equal(titleProblem("   "), "Your playlist needs a name.");
  assert.equal(titleProblem("Road trip"), null);
  assert.match(titleProblem("x".repeat(PLAYLIST_TITLE_MAX + 1)), /150/);
  assert.equal(videoCount(0), "No videos");
  assert.equal(videoCount(1), "1 video");
  assert.equal(videoCount(1200), "1,200 videos");
  assert.equal(hiddenText(0), null);
  assert.equal(hiddenText(1), "1 unavailable video is hidden");
  assert.equal(hiddenText(3), "3 unavailable videos are hidden");
  assert.equal(savedToast("Watch later", true), "Added to Watch later");
  assert.equal(savedToast("Mix", false), "Removed from Mix");
  assert.match(playlistErrorText("watch_later"), /can't be renamed/);
  assert.match(playlistErrorText("not_set_up"), /043_playlists\.sql/);
  assert.match(playlistErrorText("whatever"), /Try again/);
  assert.ok(isPlaylistVisibility("unlisted"));
  assert.ok(!isPlaylistVisibility("secret"));
});

test("rows from the database become summaries, headers and items", () => {
  const s = summaryFrom(
    { id: L, kind: "watch_later", title: "Watch later", visibility: "private", item_count: 3, has_video: true, updated_at: "2026-11-09T10:00:00Z", first_video_id: "v1", first_thumbnail_url: null, first_hls_key: "hls/v1/master.m3u8" },
    null,
  );
  assert.equal(s.kind, "watch_later");
  assert.equal(s.count, 3);
  assert.equal(s.hasVideo, true);
  assert.equal(s.thumbnail, "/api/media/v1/thumb-1.webp");
  const empty = summaryFrom({ id: L, kind: "playlist", title: "New", visibility: "nope", item_count: 0, has_video: false, first_video_id: null }, null);
  assert.equal(empty.thumbnail, null);
  assert.equal(empty.visibility, "private");

  const h = headerFrom(
    { id: L, kind: "playlist", title: "Mix", description: "", visibility: "public", updated_at: "2026-11-09T10:00:00Z", is_owner: false, owner_name: "Sample Kitchen", owner_handle: "samplekitchen", owner_avatar_url: null, item_count: 2, hidden_count: 1, first_video_id: null },
    "https://media.example.com",
  );
  assert.equal(h.owner.handle, "samplekitchen");
  assert.equal(h.hidden, 1);
  assert.equal(h.isOwner, false);

  const item = itemFrom(
    { id: "v2", title: "Pancakes", duration_s: "61.5", thumbnail_url: null, hls_key: "hls/v2/master.m3u8", preview_sprite_key: null, published_at: "2026-11-01T00:00:00Z", views: "12", channel_id: "c1", channel_handle: "samplekitchen", channel_name: "Sample Kitchen", channel_avatar_url: null, position: 4 },
    "https://media.example.com",
  );
  assert.equal(item.position, 4);
  assert.equal(item.durationS, 61.5);
  assert.equal(item.thumbnail, "https://media.example.com/hls/v2/thumb-1.webp");
});

test("043: owner only changes, Watch later stays private, others see public and unlisted ones", () => {
  const sql = readFileSync(new URL("../supabase/migrations/043_playlists.sql", import.meta.url), "utf8");
  assert.match(sql, /create table if not exists public\.playlists/);
  assert.match(sql, /create table if not exists public\.playlist_items/);
  assert.match(sql, /alter table public\.playlists enable row level security/);
  assert.match(sql, /alter table public\.playlist_items enable row level security/);
  assert.match(sql, /check \(kind <> 'watch_later' or visibility = 'private'\)/);
  assert.match(sql, /playlists_watch_later_key on public\.playlists \(owner_id\) where kind = 'watch_later'/);
  assert.match(sql, /if not found or p\.owner_id <> me then\s+raise exception 'not_found'/);
  assert.match(sql, /p\.owner_id = \(select auth\.uid\(\)\) or \(p\.kind = 'playlist' and p\.visibility <> 'private'\)/);
  assert.match(sql, /v\.visibility <> 'private' or v\.owner_id = viewer/);
  assert.match(sql, />= 5000 then\s+raise exception 'too_many_videos'/);
  assert.match(sql, />= 500 then\s+raise exception 'too_many_playlists'/);
  assert.match(sql, /#variable_conflict use_column/);
  for (const fn of ["my_playlists(uuid)", "create_playlist(text, text, uuid)", "update_playlist(uuid, text, text, text)", "delete_playlist(uuid)", "set_playlist_video(uuid, uuid, boolean)", "move_playlist_video(uuid, uuid, uuid)"]) {
    const f = fn.replace(/[()]/g, "\\$&");
    assert.match(sql, new RegExp(`revoke execute on function public\\.${f} from public, anon;`), fn);
    assert.match(sql, new RegExp(`grant execute on function public\\.${f} to authenticated;`), fn);
  }
  assert.match(sql, /grant execute on function public\.playlist_header\(uuid\) to anon, authenticated, service_role/);
  assert.match(sql, /revoke execute on function public\.playlist_owned\(uuid\) from public, anon, authenticated/);
  assert.match(sql, /'playlists',/);
  assert.doesNotMatch(sql, /—/);
});
