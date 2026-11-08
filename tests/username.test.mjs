import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  EMOJI_RANGES,
  INVISIBLE_RANGES,
  normalizeUsername,
  usernameProblem,
} from "../lib/accounts/validation.ts";

test("accepts 3 to 24 characters of anything but emoji", () => {
  for (const name of [
    "abc", "antic", "slop_tube_42", "a".repeat(24), "___", "007",
    "Typical Gamer", "dash-name", "dot.name", "émile", "Upper", "ニンジャ", "x!@#$%^&*()", "★ star ★", "a♥b",
  ]) {
    assert.equal(usernameProblem(name), null, name);
  }
});

test("counts characters, not UTF-16 units", () => {
  // Each of these is one character but two UTF-16 units.
  assert.equal(usernameProblem("𠀀".repeat(24)), null);
  assert.match(usernameProblem("𠀀".repeat(25)), /at most 24/);
});

test("rejects names that are too short or too long", () => {
  assert.match(usernameProblem("ab"), /at least 3/);
  assert.match(usernameProblem(""), /at least 3/);
  assert.match(usernameProblem("a".repeat(25)), /at most 24/);
});

test("rejects emoji, including joined, flag, keycap and styled ones", () => {
  for (const name of ["emoji😀x", "🎮🎮🎮", "heart❤️", "⭐star", "flag🇺🇸x", "fam👨‍👩‍👧", "key1️⃣x", "thumb👍🏽", "clock⌚x"]) {
    assert.match(usernameProblem(name), /emoji/, name);
  }
});

test("rejects invisible characters", () => {
  for (const name of ["zero​width", "tab\there", "rtl‮abc", "bom﻿x"]) {
    assert.match(usernameProblem(name), /invisible/, JSON.stringify(name));
  }
});

test("rejects reserved names in any case", () => {
  assert.match(usernameProblem("admin"), /reserved/);
  assert.match(usernameProblem("Admin"), /reserved/);
  assert.match(usernameProblem("SETTINGS"), /reserved/);
});

test("normalizes spaces and a leading @, keeps case", () => {
  assert.equal(normalizeUsername("  @Antic_Dev "), "Antic_Dev");
  assert.equal(normalizeUsername("@ Typical Gamer  "), "Typical Gamer");
  assert.equal(usernameProblem(normalizeUsername("Antic")), null);
});

test("the database uses the same emoji and invisible character ranges", () => {
  const sql = readFileSync(new URL("../supabase/migrations/023_open_uploads_usernames.sql", import.meta.url), "utf8");
  const esc = (n) => (n > 0xffff ? `\\U${n.toString(16).padStart(8, "0")}` : `\\u${n.toString(16).padStart(4, "0")}`);
  const cls = (ranges) => `[${ranges.map(([a, b]) => (a === b ? esc(a) : `${esc(a)}-${esc(b)}`)).join("")}]`;
  assert.ok(sql.includes(`name !~ '${cls(EMOJI_RANGES)}'`), "the emoji ranges differ from username_is_valid()");
  assert.ok(sql.includes(`name !~ '${cls(INVISIBLE_RANGES)}'`), "the invisible ranges differ from username_is_valid()");
});
