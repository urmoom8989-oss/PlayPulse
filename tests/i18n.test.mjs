// Language and Location (032): picking them, translating, local numbers and dates.
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { agoIn, compact, dateIn, subscribersIn, viewsIn } from "../lib/i18n/format.ts";
import { isLang, LANGS, LOCATIONS, locationName, pickLang, pickLocation } from "../lib/i18n/langs.ts";
import { dictionaryKeys, translate } from "../lib/i18n/t.ts";

const root = new URL("../", import.meta.url).pathname;

test("the language: the cookie, else the browser's, else English", () => {
  assert.equal(pickLang("fr", "es-MX,es;q=0.9"), "fr");
  assert.equal(pickLang(null, "es-MX,es;q=0.9,en;q=0.5"), "es");
  assert.equal(pickLang("xx", "pt-BR"), "pt");
  assert.equal(pickLang(undefined, "ko-KR,zh;q=0.8"), "en");
  assert.equal(pickLang(null, "en;q=0.2,ja;q=0.9"), "ja");
  assert.ok(LANGS.every((l) => isLang(l.code)));
});

test("the location: the cookie, else the browser's region, else the United States", () => {
  assert.equal(pickLocation("CA", "en-US"), "CA");
  assert.equal(pickLocation(null, "es-MX,es;q=0.9"), "MX");
  assert.equal(pickLocation("ZZ", "fr"), "US");
  assert.ok(LOCATIONS.includes("GB") && LOCATIONS.includes("JP"));
  assert.equal(locationName("CA", "en"), "Canada");
  assert.equal(locationName("DE", "de"), "Deutschland");
});

test("every language has the same words, with the same {placeholders}", () => {
  const en = new Set(dictionaryKeys("es"));
  for (const lang of ["fr", "de", "pt", "ja"]) assert.deepEqual(new Set(dictionaryKeys(lang)), en, lang);
  for (const lang of ["es", "fr", "de", "pt", "ja"]) {
    for (const key of dictionaryKeys(lang)) {
      const want = (key.match(/\{\w+\}/g) ?? []).sort().join();
      assert.equal((translate(lang, key).match(/\{\w+\}/g) ?? []).sort().join(), want, `${lang}: ${key}`);
    }
  }
});

test("every word the site wraps in t(\"...\") or <Tr> has a translation", () => {
  const known = new Set(dictionaryKeys("es"));
  const files = [];
  const walk = (dir) => {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.tsx?$/.test(f)) files.push(p);
    }
  };
  for (const d of ["components", "app", "lib"]) walk(join(root, d));
  const missing = [];
  for (const f of files) {
    const s = readFileSync(f, "utf8");
    if (!/useT|tFor|<Tr>/.test(s)) continue;
    for (const m of s.matchAll(/\bt\(\s*"((?:[^"\\]|\\.)+)"/g)) if (!known.has(m[1])) missing.push(`${f}: ${m[1]}`);
    for (const m of s.matchAll(/<Tr>([^<{]+)<\/Tr>/g)) if (!known.has(m[1].trim())) missing.push(`${f}: ${m[1].trim()}`);
  }
  assert.deepEqual(missing, []);
});

test("translate fills placeholders and falls back to English", () => {
  assert.equal(translate("en", "Trending in {place}", { place: "Canada" }), "Trending in Canada");
  assert.equal(translate("es", "Trending in {place}", { place: "Canadá" }), "Tendencias en Canadá");
  assert.equal(translate("ja", "Subscribe"), "チャンネル登録");
  assert.equal(translate("fr", "A sentence nobody translated"), "A sentence nobody translated");
});

test("numbers and dates: English keeps the site's own text", () => {
  assert.equal(viewsIn("en", 1234, "1.2K views"), "1.2K views");
  assert.match(viewsIn("es", 1234, "x"), /visualizaciones$/);
  assert.equal(viewsIn("de", 1, "x"), "1 Aufruf");
  assert.equal(subscribersIn("fr", 0, "x"), "Aucun abonné");
  assert.match(subscribersIn("pt", 2500, "x"), /inscritos$/);
  const now = Date.parse("2026-11-09T12:00:00Z");
  assert.equal(agoIn("en", "2026-11-06T12:00:00Z", now, "3 days ago"), "3 days ago");
  assert.equal(agoIn("es", "2026-11-06T12:00:00Z", now, "x"), "hace 3 días");
  assert.equal(agoIn("fr", "2026-11-09T11:00:00Z", now, "x"), "il y a 1 heure");
  assert.match(dateIn("de", "2026-11-08T12:00:00Z", "x"), /2026/);
  assert.ok(compact("ja", 12000).length > 0);
});

test("032: the country column, the trending function for everyone, the flag off", () => {
  const sql = readFileSync(join(root, "supabase/migrations/032_language_location.sql"), "utf8");
  assert.match(sql, /alter table public\.view_events add column if not exists country text/);
  assert.match(sql, /x-viewer-country/);
  assert.match(sql, /grant execute on function public\.trending_in\(text, int\) to anon, authenticated/);
  assert.match(sql, /'language_location',[\s\S]*?'off'/);
});
