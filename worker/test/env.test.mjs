// The worker's settings: Cloudflare R2, or any S3 compatible bucket.
import assert from "node:assert/strict";
import { test } from "node:test";
import { readConfig } from "../lib/env.mjs";

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
