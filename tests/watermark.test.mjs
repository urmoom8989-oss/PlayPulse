// The channel watermark (044): when it shows, the picture's fit, and the
// shape of the migration.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  WATERMARK_END_S,
  WATERMARK_SIZE,
  readWatermark,
  watermarkErrorText,
  watermarkFileProblem,
  watermarkFit,
  watermarkShown,
} from "../lib/channels/watermark-rules.ts";

test("entire video, the last 15 seconds, or from a custom time", () => {
  assert.equal(watermarkShown({ show: "entire", startS: 0 }, 0, 100), true);
  assert.equal(watermarkShown({ show: "custom", startS: 30 }, 29.9, 100), false);
  assert.equal(watermarkShown({ show: "custom", startS: 30 }, 30, 100), true);
  assert.equal(watermarkShown({ show: "end", startS: 0 }, 100 - WATERMARK_END_S - 0.1, 100), false);
  assert.equal(watermarkShown({ show: "end", startS: 0 }, 100 - WATERMARK_END_S, 100), true);
  assert.equal(watermarkShown({ show: "end", startS: 0 }, 1, 10), true, "a video shorter than 15 s shows it throughout");
  assert.equal(watermarkShown({ show: "end", startS: 0 }, 5, 0), false, "not before the length is known");
});

test("the picture fits a 150 square, centered", () => {
  assert.deepEqual(watermarkFit(300, 300), { dx: 0, dy: 0, dw: WATERMARK_SIZE, dh: WATERMARK_SIZE });
  assert.deepEqual(watermarkFit(600, 300), { dx: 0, dy: 38, dw: 150, dh: 75 });
  assert.deepEqual(watermarkFit(100, 400), { dx: 56, dy: 0, dw: 38, dh: 150 });
  assert.deepEqual(watermarkFit(0, 0), { dx: 0, dy: 0, dw: 150, dh: 150 });
});

test("files, rows and errors", () => {
  assert.equal(watermarkFileProblem({ type: "image/png", size: 1000 }), null);
  assert.match(watermarkFileProblem({ type: "image/gif", size: 1000 }), /PNG, JPG or WebP/);
  assert.match(watermarkFileProblem({ type: "image/webp", size: 6 * 1024 * 1024 }), /5 MB/);
  assert.equal(readWatermark(null), null);
  assert.equal(readWatermark({ watermark_url: null }), null);
  assert.equal(readWatermark({ watermark_url: "http://insecure" }), null);
  assert.deepEqual(readWatermark({ watermark_url: "https://cdn.example.com/w.webp", watermark_show: "custom", watermark_start_s: 75 }), {
    url: "https://cdn.example.com/w.webp",
    show: "custom",
    startS: 75,
  });
  assert.equal(readWatermark({ watermark_url: "https://cdn.example.com/w.webp", watermark_show: "odd" }).show, "entire");
  assert.match(watermarkErrorText("not_set_up"), /044_watermarks\.sql/);
  assert.match(watermarkErrorText("no_channel"), /channel/);
});

test("044: the owner sets it through the function, everyone reads it", () => {
  const sql = readFileSync(new URL("../supabase/migrations/044_watermarks.sql", import.meta.url), "utf8");
  assert.match(sql, /add column if not exists watermark_url text/);
  assert.match(sql, /drop constraint if exists channels_watermark_valid/);
  assert.match(sql, /watermark_show in \('entire', 'end', 'custom'\)/);
  assert.match(sql, /grant select \(watermark_url, watermark_show, watermark_start_s\) on public\.channels to anon, authenticated/);
  assert.doesNotMatch(sql, /grant update \([^)]*watermark/);
  assert.match(sql, /where c\.owner_id = me/);
  assert.match(sql, /revoke execute on function public\.set_channel_watermark\(text, text, int\) from public, anon/);
  assert.match(sql, /'watermarks', 'watermarks', true, 1048576/);
  assert.match(sql, /\(storage\.foldername\(name\)\)\[1\] = \(select auth\.uid\(\)\)::text/);
  assert.match(sql, /'watermark',/);
  assert.doesNotMatch(sql, /—/);
});
