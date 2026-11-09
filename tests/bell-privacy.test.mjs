// Bell options (All, Personalized, None) and Settings > Privacy.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { isNotifyLevel, isSubAction, LEVEL_TEXT, levelOf, NOTIFY_LEVELS, subErrorMessage } from "../lib/subscriptions/rules.ts";
import { rowToGuideChannel } from "../lib/subscriptions/types.ts";

test("the three levels, and older rows without one", () => {
  assert.deepEqual([...NOTIFY_LEVELS], ["all", "personalized", "none"]);
  for (const l of NOTIFY_LEVELS) assert.ok(isNotifyLevel(l) && LEVEL_TEXT[l].label && LEVEL_TEXT[l].toast);
  assert.equal(isNotifyLevel("some"), false);
  assert.equal(levelOf("personalized", true), "personalized");
  assert.equal(levelOf(undefined, true), "all");
  assert.equal(levelOf(null, false), "none");
  assert.equal(isSubAction("level"), true);
  assert.equal(subErrorMessage("bell_options_off"), "Notification options aren't on yet.");
});

test("my_subscriptions rows carry the level", () => {
  const row = { channel_id: "c", handle: "h", name: "N", avatar_url: null, notify: true, subscribed_at: "", latest_upload_at: null, unseen: 0 };
  assert.equal(rowToGuideChannel({ ...row, notify_level: "personalized" }).level, "personalized");
  assert.equal(rowToGuideChannel(row).level, "all");
  assert.equal(rowToGuideChannel({ ...row, notify: false }).level, "none");
});

test("027: levels kept in step, privacy not readable, flags off", () => {
  const sql = readFileSync(new URL("../supabase/migrations/028_bell_privacy.sql", import.meta.url), "utf8");
  assert.match(sql, /check \(notify_level in \('all', 'personalized', 'none'\)\)/);
  assert.match(sql, /create trigger subscriptions_sync_notify/);
  assert.match(sql, /revoke select \(subscriptions_private, playlists_private\) on public\.profiles from anon, authenticated/);
  assert.match(sql, /grant execute on function public\.set_notify_level\(uuid, text\) to authenticated;/);
  assert.doesNotMatch(sql, /set_notify_level\(uuid, text\) to anon/);
  assert.match(sql, /grant execute on function public\.channel_subscriptions\(uuid, int\) to anon, authenticated/);
  assert.match(sql, /revoke execute on function public\.feature_on\(text, uuid\) from public, anon, authenticated/);
  for (const key of ["bell_options", "privacy_settings"]) assert.match(sql, new RegExp(`'${key}',[\\s\\S]*?'off'`));
});
