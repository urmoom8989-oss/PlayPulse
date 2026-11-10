// Unlisted, Schedule, Drafts and Paid promotion (042): the rules the uploader
// and the studio editor share, and the shape of the migration.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  SCHEDULE_MAX_AHEAD_MS,
  SCHEDULE_MIN_AHEAD_MS,
  defaultSchedule,
  fromLocalInput,
  optionsErrorText,
  scheduleLabel,
  scheduleProblem,
  toLocalInput,
} from "../lib/upload/options-rules.ts";

test("datetime-local values go to times in the viewer's zone and back", () => {
  const d = new Date(2026, 10, 10, 18, 5);
  assert.equal(toLocalInput(d), "2026-11-10T18:05");
  assert.equal(fromLocalInput("2026-11-10T18:05")?.getTime(), d.getTime());
  for (const bad of ["", "tomorrow", "2026-11-10", "2026-11-10 18:05", "2026-13-40T99:99x"]) assert.equal(fromLocalInput(bad), null, bad);
});

test("the first time offered is the next whole hour at least 5 minutes away", () => {
  assert.equal(defaultSchedule(new Date(2026, 10, 10, 18, 20)), "2026-11-10T19:00");
  // 18:57 plus 5 minutes is past 19:00, so 20:00.
  assert.equal(defaultSchedule(new Date(2026, 10, 10, 18, 57)), "2026-11-10T20:00");
  assert.equal(defaultSchedule(new Date(2026, 11, 31, 23, 30)), "2027-01-01T00:00");
  const now = new Date(2026, 10, 10, 18, 20);
  assert.equal(scheduleProblem(defaultSchedule(now), now.getTime()), null);
});

test("a schedule is at least 5 minutes ahead and within a year", () => {
  const now = new Date(2026, 10, 10, 12, 0).getTime();
  assert.equal(scheduleProblem("2026-11-10T13:00", now), null);
  assert.match(scheduleProblem("2026-11-10T12:03", now), /at least 5 minutes/);
  assert.match(scheduleProblem("2026-11-09T12:00", now), /at least 5 minutes/);
  assert.match(scheduleProblem("2027-11-11T12:00", now), /within a year/);
  assert.match(scheduleProblem("", now), /Pick a date and time/);
  assert.equal(SCHEDULE_MIN_AHEAD_MS, 5 * 60 * 1000);
  assert.equal(SCHEDULE_MAX_AHEAD_MS, 365 * 24 * 60 * 60 * 1000);
});

test("labels and errors in words", () => {
  assert.match(scheduleLabel(new Date(2026, 10, 10, 18, 0)), /Nov 10, 2026.*6:00\s?PM/);
  assert.match(optionsErrorText("bad_schedule"), /5 minutes/);
  assert.match(optionsErrorText("not_set_up"), /042_upload_options\.sql/);
  assert.match(optionsErrorText("off"), /switched off/);
  assert.match(optionsErrorText("anything"), /didn't save/);
});

test("042: owner only, scheduled videos stay private, the worker publishes them", () => {
  const sql = readFileSync(new URL("../supabase/migrations/042_upload_options.sql", import.meta.url), "utf8");
  for (const col of ["publish_at timestamptz", "draft boolean not null default false", "paid_promotion boolean not null default false"]) {
    assert.match(sql, new RegExp(`add column if not exists ${col}`));
  }
  assert.match(sql, /create or replace function public\.set_upload_options\(/);
  assert.match(sql, /v\.owner_id <> me/);
  assert.match(sql, /raise exception 'bad_schedule'/);
  assert.match(sql, /interval '1 year'/);
  assert.match(sql, /-- Scheduled: private until the time comes\.\n\s+vis := 'private';/);
  assert.match(sql, /create or replace function public\.publish_scheduled\(\)/);
  assert.match(sql, /grant execute on function public\.publish_scheduled\(\) to service_role/);
  assert.match(sql, /revoke execute on function public\.publish_scheduled\(\) from public, anon, authenticated/);
  assert.match(sql, /revoke execute on function public\.set_upload_options\(uuid, text, timestamptz, boolean, boolean\) from public, anon/);
  assert.match(sql, /grant execute on function public\.video_paid_promotion\(uuid\) to anon, authenticated, service_role/);
  // A private video's paid promotion is only the owner's to read.
  assert.match(sql, /v\.visibility <> 'private' or v\.owner_id = \(select auth\.uid\(\)\)/);
  assert.match(sql, /c\.suspended_at is not null/);
  assert.match(sql, /'upload_options',/);
  assert.match(sql, /on conflict \(key\) do nothing/);
  assert.doesNotMatch(sql, /\u2014/);
});
