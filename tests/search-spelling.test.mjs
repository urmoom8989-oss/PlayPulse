// Search spelling correction: when to show which line, and the links.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { readExact } from "../lib/search/query.ts";
import { exactHref, markCorrection, spellingMode } from "../lib/search/spelling.ts";

test("spellingMode: results for the fix when nothing was found, a link otherwise", () => {
  assert.equal(spellingMode("minecarft", "minecraft", false, false), "showing");
  assert.equal(spellingMode("minecarft", "minecraft", true, false), "did-you-mean");
  assert.equal(spellingMode("minecarft", null, false, false), "none");
  assert.equal(spellingMode("minecraft", "minecraft", false, false), "none");
  // "Search instead for" asked for exactly what was typed.
  assert.equal(spellingMode("minecarft", "minecraft", false, true), "none");
});

test("markCorrection marks only the words that changed", () => {
  assert.deepEqual(markCorrection("elden rign bos guide", "elden ring boss guide"), [
    { text: "elden", changed: false },
    { text: "ring", changed: true },
    { text: "boss", changed: true },
    { text: "guide", changed: false },
  ]);
  assert.deepEqual(markCorrection("Minecarft", "minecraft"), [{ text: "minecraft", changed: true }]);
});

test("Search instead for keeps the filters and adds exact=1", () => {
  assert.equal(exactHref("minecarft"), "/results?search_query=minecarft&exact=1");
  assert.equal(exactHref("minecarft", { sort: "views" }), "/results?search_query=minecarft&sort=views&exact=1");
  assert.equal(readExact(new URLSearchParams("search_query=a&exact=1")), true);
  assert.equal(readExact({ search_query: "a", exact: "0" }), false);
  assert.equal(readExact({}), false);
});

test("026 adds the word list, the function for everyone and the flag off", () => {
  const sql = readFileSync(new URL("../supabase/migrations/026_search_spelling.sql", import.meta.url), "utf8");
  assert.match(sql, /alter table public\.search_words enable row level security/);
  assert.match(sql, /revoke all on public\.search_words from anon, authenticated/);
  assert.match(sql, /grant execute on function public\.search_spelling\(text\) to anon, authenticated/);
  assert.match(sql, /'search_spelling',[\s\S]*'off'/);
});
