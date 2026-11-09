// The Retry button for videos whose processing failed (033_retry_failed.sql).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { RETRIES_PER_DAY, canRetry, failureText, retryMessage } from "../lib/processing/retry.ts";

test("only a video whose processing failed can be retried", () => {
  assert.equal(canRetry("failed", { status: "failed", error: "boom" }), true);
  // An upload that never finished has no job: only a new upload helps.
  assert.equal(canRetry("failed", null), false);
  assert.equal(canRetry("failed", undefined), false);
  // Already back in the queue, or still going.
  assert.equal(canRetry("failed", { status: "queued", error: null }), false);
  assert.equal(canRetry("processing", { status: "running", error: null }), false);
  assert.equal(canRetry("ready", { status: "done", error: null }), false);
});

test("the encoder's errors in words for the owner", () => {
  assert.equal(failureText("Please reduce your request rate."), "Storage was too busy while saving the processed video.");
  assert.equal(failureText("An error was encountered. SlowDown"), "Storage was too busy while saving the processed video.");
  assert.equal(failureText("this file could not be read as a video (moov atom not found)"), "This file couldn't be read as a video.");
  assert.equal(failureText("the source file is not in storage"), "The uploaded file is missing or incomplete.");
  assert.equal(failureText("source size 10 does not match the upload (20)"), "The uploaded file is missing or incomplete.");
  assert.equal(failureText("took longer than 7 h"), "Processing took longer than the time limit.");
  assert.equal(failureText("the worker stopped during the encode"), "The encoder restarted while processing.");
  assert.equal(failureText("the worker was stopped"), "The encoder restarted while processing.");
  assert.equal(failureText("not enough disk: 1 GB free, 20 GB needed"), "The encoder ran out of space.");
  assert.equal(failureText(null), "Processing failed.");
  assert.equal(failureText("  "), "Processing failed.");
  assert.equal(failureText("ffmpeg exited with code 1"), "ffmpeg exited with code 1");
  const long = failureText("x".repeat(300));
  assert.ok(long.length <= 120 && long.endsWith("..."));
});

test("what the toast says", () => {
  assert.match(retryMessage(null), /Processing again/);
  assert.match(retryMessage("cannot_retry"), /Upload the file again/);
  assert.match(retryMessage("rate_limited"), new RegExp(`${RETRIES_PER_DAY} times a day`));
  assert.match(retryMessage("something_new"), /Couldn't retry/);
  for (const code of [null, "cannot_retry", "not_failed", "rate_limited", "in_trash", "not_found", "failed"]) {
    assert.doesNotMatch(retryMessage(code), /—/, "no em dashes");
  }
});

test("033: the owner retries their own failed video, 3 times a day, behind the flag", () => {
  const sql = readFileSync(new URL("../supabase/migrations/033_retry_failed.sql", import.meta.url), "utf8");
  assert.match(sql, /add column if not exists manual_retries/);
  assert.match(sql, /feature_on\('retry_failed', me\)/);
  assert.match(sql, /v\.owner_id <> me/);
  assert.match(sql, /j\.manual_retries >= 3/);
  assert.match(sql, /grant execute on function public\.retry_encode\(uuid\) to authenticated/);
  assert.match(sql, /revoke execute on function public\.retry_encode\(uuid\) from public, anon/);
  assert.match(sql, /'retry_failed',[\s\S]*?'off'/);
  assert.equal(RETRIES_PER_DAY, 3);
});
