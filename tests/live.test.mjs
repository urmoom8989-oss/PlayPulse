// Premieres and live from an upload: states, texts, playlists cut at "now", chat.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { isMasterPlaylist, stripSubtitles, truncateMediaPlaylist } from "../lib/live/playlist.ts";
import {
  atLiveEdge,
  broadcastMeta,
  broadcastState,
  cardBadge,
  cardMeta,
  formatCountdown,
  notificationText,
  replayWindow,
  roughDuration,
} from "../lib/live/state.ts";
import { cardBroadcastFromRow, chatError, rowToChatMessage } from "../lib/live/types.ts";
import { serveMedia } from "../lib/watch/media.ts";

const AT = "2026-11-09T00:00:00.000Z";
const T0 = Date.parse(AT);

test("a broadcast is upcoming, then live for the video's length, then ended", () => {
  assert.equal(broadcastState(AT, 120, T0 - 1), "upcoming");
  assert.equal(broadcastState(AT, 120, T0), "live");
  assert.equal(broadcastState(AT, 120, T0 + 119_999), "live");
  assert.equal(broadcastState(AT, 120, T0 + 120_000), "ended");
  assert.equal(broadcastState(AT, null, T0), "ended");
});

test("countdown and rough durations", () => {
  assert.equal(formatCountdown(3 * 86400_000), "3 days");
  assert.equal(formatCountdown(86400_000 + 5), "1 day");
  assert.equal(formatCountdown(3909_000), "1:05:09");
  assert.equal(formatCountdown(299_500), "5:00");
  assert.equal(formatCountdown(-5), "0:00");
  assert.equal(roughDuration(59), "59 seconds");
  assert.equal(roughDuration(61), "1 minute");
  assert.equal(roughDuration(7300), "2 hours");
});

test("the lines and badges the pages show", () => {
  const live = { kind: "live", at: AT, state: "live", viewers: 1234 };
  assert.equal(broadcastMeta(live, T0 + 5 * 60_000), "1,234 watching now · Started streaming 5 minutes ago");
  assert.match(broadcastMeta({ ...live, kind: "premiere" }, T0 + 60_000), /^1,234 watching now · Premiere in progress\. Started 1 minute ago$/);
  assert.match(broadcastMeta({ ...live, state: "upcoming", viewers: 3 }, T0), /^3 waiting · Scheduled for /);
  assert.match(broadcastMeta({ ...live, state: "ended" }, T0), /^Streamed live on /);
  assert.match(broadcastMeta({ ...live, kind: "premiere", state: "ended" }, T0), /^Premiered /);
  assert.deepEqual(cardBadge({ kind: "live", state: "live" }), { text: "LIVE NOW", live: true });
  assert.deepEqual(cardBadge({ kind: "premiere", state: "live" }), { text: "PREMIERING NOW", live: true });
  assert.deepEqual(cardBadge({ kind: "premiere", state: "upcoming" }), { text: "PREMIERE", live: false });
  assert.deepEqual(cardBadge({ kind: "live", state: "upcoming" }), { text: "UPCOMING", live: false });
  assert.equal(cardBadge({ kind: "live", state: "ended" }), null);
  assert.equal(cardMeta({ kind: "premiere", at: AT, state: "upcoming", viewers: 0 }, T0 - 2 * 3600_000), "Premieres in 2 hours");
  assert.equal(cardMeta({ kind: "live", at: AT, state: "live", viewers: 7 }, T0), "7 watching");
  assert.equal(cardMeta({ kind: "live", at: AT, state: "ended", viewers: 0 }, T0), null);
  assert.equal(notificationText("TG", "Run", null), "TG uploaded: Run");
  assert.equal(notificationText("TG", "Run", { kind: "live", state: "live" }), "TG is live: Run");
  assert.equal(notificationText("TG", "Run", { kind: "premiere", state: "upcoming" }), "TG scheduled a Premiere: Run");
  assert.equal(atLiveEdge(95, 100, 10), true);
  assert.equal(atLiveEdge(80, 100, 10), false);
  assert.deepEqual(replayWindow(125), { from: 120, to: 180 });
  assert.deepEqual(replayWindow(-3), { from: 0, to: 60 });
});

const MEDIA = [
  "#EXTM3U",
  "#EXT-X-VERSION:7",
  "#EXT-X-TARGETDURATION:4",
  "#EXT-X-MEDIA-SEQUENCE:0",
  "#EXT-X-PLAYLIST-TYPE:VOD",
  "#EXT-X-INDEPENDENT-SEGMENTS",
  '#EXT-X-MAP:URI="init_0.mp4"',
  "#EXTINF:4.000000,",
  "seg_00000.m4s",
  "#EXTINF:4.000000,",
  "seg_00001.m4s",
  "#EXTINF:4.000000,",
  "seg_00002.m4s",
  "#EXTINF:2.500000,",
  "seg_00003.m4s",
  "#EXT-X-ENDLIST",
].join("\n");

test("a media playlist is cut at the segments that have aired, as a growing EVENT playlist", () => {
  const at9 = truncateMediaPlaylist(MEDIA, 9);
  assert.match(at9, /#EXT-X-PLAYLIST-TYPE:EVENT/);
  assert.doesNotMatch(at9, /VOD|ENDLIST/);
  assert.match(at9, /#EXT-X-MAP:URI="init_0.mp4"/);
  assert.deepEqual(at9.match(/seg_\d+\.m4s/g), ["seg_00000.m4s", "seg_00001.m4s"]);
  // Before the first segment has ended, the first one is still there.
  assert.deepEqual(truncateMediaPlaylist(MEDIA, 0.5).match(/seg_\d+\.m4s/g), ["seg_00000.m4s"]);
  assert.equal(truncateMediaPlaylist(MEDIA, 100).match(/seg_\d+\.m4s/g).length, 4);
  // Without a type line, EVENT is added after the header.
  assert.match(truncateMediaPlaylist(MEDIA.replace("#EXT-X-PLAYLIST-TYPE:VOD\n", ""), 5), /#EXT-X-VERSION:7\n#EXT-X-PLAYLIST-TYPE:EVENT/);
});

test("the master playlist loses its captions while live", () => {
  const master = [
    "#EXTM3U",
    "#EXT-X-VERSION:7",
    '#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="English",LANGUAGE="en",URI="captions/en.m3u8"',
    '#EXT-X-STREAM-INF:BANDWIDTH=1100000,RESOLUTION=640x360,CODECS="avc1.64001e,mp4a.40.2",SUBTITLES="subs"',
    "360p/index.m3u8",
  ].join("\n");
  assert.ok(isMasterPlaylist(master) && !isMasterPlaylist(MEDIA));
  const out = stripSubtitles(master);
  assert.doesNotMatch(out, /SUBTITLES/);
  assert.match(out, /BANDWIDTH=1100000,RESOLUTION=640x360,CODECS="avc1.64001e,mp4a.40.2"\n360p\/index.m3u8/);
});

test("the media route cuts playlists only while the broadcast is on, never cached", async () => {
  const ID = "ab000000-0000-4000-8000-000000000009";
  const ctx = (now) => ({
    now: () => now,
    flagOn: async () => true,
    db: { watchVideo: async () => ({ status: "ready", is_owner: false, hls_key: `hls/${ID}/master.m3u8`, broadcast_at: AT, duration_s: 14.5 }) },
    storage: { getText: async () => MEDIA, presign: async (k) => `https://bucket.example/${k}` },
  });
  const during = await serveMedia(ID, ["360p", "index.m3u8"], ctx(T0 + 9000));
  assert.equal(during.status, 200);
  assert.equal(during.headers["cache-control"], "private, no-store");
  assert.equal(during.body.match(/seg_\d+\.m4s/g).length, 2);
  const after = await serveMedia(ID, ["360p", "index.m3u8"], ctx(T0 + 60_000));
  assert.match(after.body, /#EXT-X-ENDLIST/);
  assert.equal(after.headers["cache-control"], "private, max-age=60");
});

test("chat rows and errors", () => {
  const m = rowToChatMessage({ id: "7", offset_s: "-3.5", created_at: AT, body: "hi", author_name: null, author_handle: "a", author_avatar_url: null, is_owner: true, is_mine: null });
  assert.deepEqual(m, { id: 7, offsetS: -3.5, createdAt: AT, body: "hi", author: { name: "Someone", handle: "a", avatarUrl: null }, isOwner: true, isMine: false });
  assert.equal(chatError("slow_down"), "Slow down: one message every 2 seconds.");
  assert.equal(chatError("whatever"), "Couldn't send that. Try again.");
  assert.deepEqual(cardBroadcastFromRow({ kind: "live", at: AT, state: "live", viewers: "4" }), { kind: "live", at: AT, state: "live", viewers: 4 });
  assert.equal(cardBroadcastFromRow({ kind: "stream", at: AT, state: "live", viewers: 0 }), null);
});

test("029: tables closed to the API, live only for allowed channels, flags off", () => {
  const sql = readFileSync(new URL("../supabase/migrations/029_live.sql", import.meta.url), "utf8");
  for (const t of ["broadcast_reminders", "live_presence", "live_chat"]) {
    assert.match(sql, new RegExp(`alter table public\\.${t} enable row level security`));
    assert.match(sql, new RegExp(`revoke all on public\\.${t} from anon, authenticated`));
  }
  assert.match(sql, /update public\.channels set can_go_live = true where lower\(handle\) = 'typicalgamer'/);
  assert.match(sql, /raise exception 'live_not_allowed'/);
  assert.match(sql, /grant execute on function public\.live_chat_post\(uuid, text\) to authenticated;/);
  for (const key of ["premieres", "live"]) assert.match(sql, new RegExp(`'${key}',[\\s\\S]*?'off'`));
});
