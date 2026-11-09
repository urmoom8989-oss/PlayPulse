// Switch account (031): the rules, and the migration keeps everything closed.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { channelAccountEmail, channelNameProblem, isChannelAccountEmail, rowToAccount, switchError, usernameFor } from "../lib/switch/rules.ts";

test("new channel names and the usernames they ask for", () => {
  assert.equal(channelNameProblem(""), "Give the channel a name.");
  assert.equal(channelNameProblem("  "), "Give the channel a name.");
  assert.match(channelNameProblem("x".repeat(51)), /50/);
  assert.equal(channelNameProblem("TG Clips"), null);
  assert.equal(usernameFor("TG Clips"), "TGClips");
  assert.equal(usernameFor("ab"), "abchannel");
  assert.equal(usernameFor("Ünïcödé Gaming!!"), "ÜnïcödéGaming");
  assert.ok(usernameFor("a".repeat(40)).length <= 24);
});

test("an extra channel's address is never shown as an email", () => {
  const e = channelAccountEmail("AB12-cd34", "PlayPulse.example");
  assert.equal(e, "channel_ab12cd34@users.noreply.playpulse.example");
  assert.equal(isChannelAccountEmail(e), true);
  assert.equal(isChannelAccountEmail("someone@example.com"), false);
});

test("rows and errors", () => {
  const a = rowToAccount({ id: "1", username: "tg", display_name: "", avatar_url: null, handle: "tg", channel_name: "TG", subscriber_count: "12", is_current: true, is_main: false });
  assert.deepEqual(a, { id: "1", username: "tg", name: "tg", avatarUrl: null, handle: "tg", channelName: "TG", subscriberCount: 12, current: true, main: false });
  assert.match(switchError("not_configured"), /SUPABASE_SERVICE_ROLE_KEY/);
  assert.equal(switchError("nope"), "Something went wrong. Try again.");
});

test("031: links are closed to the API, linking is for the server only, the flag starts off", () => {
  const sql = readFileSync(new URL("../supabase/migrations/031_switch_account.sql", import.meta.url), "utf8");
  assert.match(sql, /alter table public\.account_links enable row level security/);
  assert.match(sql, /revoke all on public\.account_links from anon, authenticated/);
  assert.match(sql, /grant execute on function public\.link_channel_account\(uuid, uuid\) to service_role/);
  assert.doesNotMatch(sql, /link_channel_account\(uuid, uuid\) to authenticated/);
  assert.match(sql, /'switch_account',[\s\S]*?'off'/);
});
