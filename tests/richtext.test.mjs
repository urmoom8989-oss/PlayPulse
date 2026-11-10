// Links, #hashtags and timestamps in descriptions (lib/watch/richtext.ts), and
// the swipe down to refresh helpers (lib/pull-refresh.ts).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { PULL_MAX, PULL_TRIGGER, pullAllowed, pullDistance } from "../lib/pull-refresh.ts";
import { cleanTag, hashtagHref, linkHref, splitRich } from "../lib/watch/richtext.ts";

const kinds = (parts) => parts.map((p) => (p.kind === "text" ? p.text : `[${p.kind}:${p.text}]`)).join("");

test("links open, sentence punctuation stays outside, and every character is kept", () => {
  const text = "Merch: https://shop.example.com/tees?id=3. Discord (www.example.org/chat), ok!";
  const parts = splitRich(text);
  assert.equal(parts.map((p) => p.text).join(""), text);
  assert.equal(kinds(parts), "Merch: [link:https://shop.example.com/tees?id=3]. Discord ([link:www.example.org/chat]), ok!");
  assert.equal(parts.find((p) => p.kind === "link" && p.text.startsWith("www")).href, "https://www.example.org/chat");
  // Parentheses that belong to the link stay in it.
  assert.equal(kinds(splitRich("see https://en.example.org/wiki/Cat_(animal) now")), "see [link:https://en.example.org/wiki/Cat_(animal)] now");
});

test("only http and https become links", () => {
  assert.equal(linkHref("javascript:alert(1)"), null);
  assert.equal(linkHref("https://example.com"), "https://example.com/");
  assert.equal(kinds(splitRich("javascript:alert(1) ftp://example.com")), "javascript:alert(1) ftp://example.com");
});

test("#hashtags lead to their page; numbers, ## and anchors in links are not tags", () => {
  const parts = splitRich("New vlog! #Gaming #minecraft_2026 #1 issue ##double a#b https://example.com/#top");
  assert.equal(kinds(parts), "New vlog! [tag:#Gaming] [tag:#minecraft_2026] #1 issue ##double a#b [link:https://example.com/#top]");
  assert.equal(hashtagHref("Gaming"), "/hashtag/gaming");
  assert.equal(kinds(splitRich("(#café) #日本")), "([tag:#café]) [tag:#日本]");
});

test("timestamps with player extras, next to links and tags", () => {
  const text = "0:00 Intro #tips\n1:05 Setup https://example.com\n";
  assert.equal(kinds(splitRich(text)), "0:00 Intro [tag:#tips]\n1:05 Setup [link:https://example.com]\n");
  assert.equal(kinds(splitRich(text, { times: true })), "[time:0:00] Intro [tag:#tips]\n[time:1:05] Setup [link:https://example.com]\n");
  assert.equal(splitRich(text, { times: true })[2].seconds, undefined);
  assert.equal(splitRich(text, { times: true }).find((p) => p.kind === "time" && p.text === "1:05").seconds, 65);
});

test("the hashtag page takes clean tags only", () => {
  assert.equal(cleanTag("gaming"), "gaming");
  assert.equal(cleanTag("%23Gaming"), "Gaming");
  assert.equal(cleanTag("caf%C3%A9"), "café");
  for (const bad of ["", "123", "a b", "<script>", "x".repeat(101), "%E0%A4%A"]) assert.equal(cleanTag(bad), null, bad);
});

test("swipe down: about 110 px of finger refreshes, never more than PULL_MAX, not on the Snips feed", () => {
  assert.equal(pullDistance(0), 0);
  assert.ok(pullDistance(100) < PULL_TRIGGER && pullDistance(115) >= PULL_TRIGGER);
  assert.ok(pullDistance(10_000) <= PULL_MAX);
  assert.equal(pullAllowed("/"), true);
  assert.equal(pullAllowed("/watch"), true);
  assert.equal(pullAllowed("/shorts"), false);
  assert.equal(pullAllowed("/shorts/abc"), false);
  assert.equal(pullAllowed("/shortsy"), true);
});

test("040: both flags on for everyone, re-runnable", () => {
  const sql = readFileSync(new URL("../supabase/migrations/040_links_and_pull_refresh.sql", import.meta.url), "utf8");
  for (const key of ["description_links", "pull_to_refresh"]) assert.ok(sql.includes(`'${key}'`), key);
  assert.match(sql, /on conflict \(key\) do nothing/);
  const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(css, /html\[data-pull-refresh="on"\][\s\S]*?overscroll-behavior-y: none/);
});
