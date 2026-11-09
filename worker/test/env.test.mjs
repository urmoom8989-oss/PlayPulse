// The worker's settings: Cloudflare R2, or any S3 compatible bucket.
import assert from "node:assert/strict";
import { test } from "node:test";
import { captionThreads, readConfig } from "../lib/env.mjs";

const DB = { SUPABASE_URL: "https://example.supabase.test", SUPABASE_SERVICE_ROLE_KEY: "test-service-key" };

test("env: R2 settings work as before", () => {
  const c = readConfig({ ...DB, R2_ACCOUNT_ID: "acct", R2_ACCESS_KEY_ID: "k", R2_SECRET_ACCESS_KEY: "s", R2_BUCKET: "videos" });
  assert.deepEqual(c.missing, []);
  assert.equal(c.bucket, "videos");
  assert.equal(c.r2.accountId, "acct");
  assert.equal(c.r2.endpoint, undefined);
});

test("env: S3 settings replace R2 when S3_ENDPOINT is set", () => {
  const c = readConfig({
    ...DB,
    S3_ENDPOINT: "https://storage.example.test/",
    S3_ACCESS_KEY_ID: "k",
    S3_SECRET_ACCESS_KEY: "s",
    S3_BUCKET: "videos-abc",
    S3_REGION: "us-east-1",
    S3_FORCE_PATH_STYLE: "false",
  });
  assert.deepEqual(c.missing, []);
  assert.equal(c.bucket, "videos-abc");
  assert.equal(c.r2.endpoint, "https://storage.example.test");
  assert.equal(c.r2.region, "us-east-1");
  assert.equal(c.r2.forcePathStyle, false);
  assert.equal(c.r2.accessKeyId, "k");
});

test("env: S3 path style and region default to on and auto", () => {
  const c = readConfig({ ...DB, S3_ENDPOINT: "https://s.test", S3_ACCESS_KEY_ID: "k", S3_SECRET_ACCESS_KEY: "s", S3_BUCKET: "b" });
  assert.equal(c.r2.forcePathStyle, true);
  assert.equal(c.r2.region, "auto");
});

test("env: missing settings are named", () => {
  assert.deepEqual(readConfig({}).missing, [
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "R2_ACCOUNT_ID",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
    "R2_BUCKET",
  ]);
  assert.deepEqual(readConfig({ ...DB, S3_ENDPOINT: "https://s.test" }).missing, [
    "S3_ACCESS_KEY_ID",
    "S3_SECRET_ACCESS_KEY",
    "S3_BUCKET",
  ]);
});

test("env: captions are on when CAPTIONS_MODEL is set, unless CAPTIONS is off", () => {
  const R2 = { R2_ACCOUNT_ID: "a", R2_ACCESS_KEY_ID: "k", R2_SECRET_ACCESS_KEY: "s", R2_BUCKET: "b" };
  assert.equal(readConfig({ ...DB, ...R2 }).captions, null);
  const c = readConfig({ ...DB, ...R2, CAPTIONS_MODEL: "/opt/whisper/speech.bin", CAPTIONS_VAD_MODEL: "/opt/whisper/vad.bin", CAPTIONS_THREADS: "3" });
  assert.deepEqual(c.captions, { bin: "whisper-cli", model: "/opt/whisper/speech.bin", vadModel: "/opt/whisper/vad.bin", threads: 3 });
  const own = readConfig({ ...DB, ...R2, CAPTIONS_MODEL: "/m.bin", WHISPER_BIN: "/usr/local/bin/whisper-cli" }).captions;
  assert.equal(own.bin, "/usr/local/bin/whisper-cli");
  assert.equal(own.vadModel, null);
  for (const off of ["off", "OFF", "false", "0", "no"]) {
    assert.equal(readConfig({ ...DB, ...R2, CAPTIONS_MODEL: "/m.bin", CAPTIONS: off }).captions, null, off);
  }
});

test("env: CAPTIONS_THREADS, or the CPU count up to 8", () => {
  assert.equal(captionThreads("", 2), 2);
  assert.equal(captionThreads("", 32), 8);
  assert.equal(captionThreads("12", 2), 12);
  assert.equal(captionThreads("zero", 4), 4);
  assert.equal(captionThreads("0", 4), 4);
  assert.equal(captionThreads("1.5", 4), 4);
  assert.equal(captionThreads("", 0), 1);
});

test("env: START_WAIT_S, 20 seconds unless set, at most 2 minutes", () => {
  const base = { ...DB, R2_ACCOUNT_ID: "acct", R2_ACCESS_KEY_ID: "k", R2_SECRET_ACCESS_KEY: "s", R2_BUCKET: "videos" };
  assert.equal(readConfig(base).startWaitMs, 20000);
  assert.equal(readConfig({ ...base, START_WAIT_S: "0" }).startWaitMs, 0);
  assert.equal(readConfig({ ...base, START_WAIT_S: "45" }).startWaitMs, 45000);
  assert.equal(readConfig({ ...base, START_WAIT_S: "900" }).startWaitMs, 120000);
  assert.equal(readConfig({ ...base, START_WAIT_S: "soon" }).startWaitMs, 20000);
});
