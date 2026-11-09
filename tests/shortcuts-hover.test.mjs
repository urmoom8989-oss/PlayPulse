// More keyboard shortcuts (< > , . Home End, Shift+? and /) and hover previews.
import assert from "node:assert/strict";
import { test } from "node:test";
import { hoverStart, hoverVideoAllowed } from "../lib/feed/preview.ts";
import { FRAME_S, keyAction, stepSpeed } from "../lib/watch/keys.ts";
import { SPEEDS } from "../lib/watch/quality.ts";
import { isSearchKey, isShortcutsKey, SHORTCUT_GROUPS } from "../lib/watch/shortcuts.ts";

test("the new keys only work with the more_shortcuts flag", () => {
  for (const key of ["<", ">", ",", ".", "Home", "End"]) assert.equal(keyAction({ key }), null, key);
  const k = (key, extra = {}) => keyAction({ key, ...extra }, true);
  assert.deepEqual(k("<"), { type: "speed-step", step: -1 });
  assert.deepEqual(k(">"), { type: "speed-step", step: 1 });
  assert.deepEqual(k(","), { type: "frame-step", step: -1 });
  assert.deepEqual(k("."), { type: "frame-step", step: 1 });
  assert.deepEqual(k("Home"), { type: "seek-edge", edge: "start" });
  assert.deepEqual(k("End"), { type: "seek-edge", edge: "end" });
  // The old keys still work, and typing or a held modifier still wins.
  assert.deepEqual(k("k"), { type: "toggle-play" });
  assert.equal(k(".", { targetTag: "INPUT" }), null);
  assert.equal(k(">", { ctrlKey: true }), null);
  assert.equal(k("End", { targetEditable: true }), null);
});

test("stepSpeed walks the gear menu's speeds and stops at the ends", () => {
  assert.equal(stepSpeed(1, 1, SPEEDS), 1.25);
  assert.equal(stepSpeed(1, -1, SPEEDS), 0.75);
  assert.equal(stepSpeed(2, 1, SPEEDS), 2);
  assert.equal(stepSpeed(0.25, -1, SPEEDS), 0.25);
  // A speed that is not on the list goes to its neighbour.
  assert.equal(stepSpeed(1.1, 1, SPEEDS), 1.25);
  assert.equal(stepSpeed(1.1, -1, SPEEDS), 1);
  assert.equal(stepSpeed(1, 1, []), 1);
  assert.ok(Math.abs(FRAME_S - 1 / 30) < 1e-12);
});

test("Shift+? and / outside text fields", () => {
  assert.equal(isShortcutsKey({ key: "?" }, false), true);
  assert.equal(isShortcutsKey({ key: "?" }, true), false);
  assert.equal(isShortcutsKey({ key: "?", ctrlKey: true }, false), false);
  assert.equal(isShortcutsKey({ key: "/" }, false), false);
  assert.equal(isSearchKey({ key: "/" }, false), true);
  assert.equal(isSearchKey({ key: "/" }, true), false);
  assert.equal(isSearchKey({ key: "/", metaKey: true }, false), false);
});

test("the shortcuts dialog lists every key the player knows", () => {
  const keys = SHORTCUT_GROUPS.flatMap((g) => g.items.flatMap((i) => i.keys));
  for (const k of ["k", "j", "l", ",", ".", "<", ">", "Home", "End", "f", "t", "i", "m", "c", "+", "-", "/", "?"]) {
    assert.ok(keys.includes(k), k);
  }
  const labels = SHORTCUT_GROUPS.flatMap((g) => g.items.map((i) => i.label));
  assert.equal(new Set(labels).size, labels.length, "labels are unique (they are React keys)");
});

test("hover video: where it starts and who gets it", () => {
  assert.equal(hoverStart(null), 0);
  assert.equal(hoverStart(30), 0);
  assert.equal(hoverStart(59.9), 0);
  assert.equal(hoverStart(60), 6);
  assert.equal(hoverStart(300), 30);
  assert.equal(hoverStart(7200), 60);
  assert.equal(hoverVideoAllowed({ finePointer: true, reducedMotion: false, saveData: false }), true);
  assert.equal(hoverVideoAllowed({ finePointer: false, reducedMotion: false, saveData: false }), false);
  assert.equal(hoverVideoAllowed({ finePointer: true, reducedMotion: true, saveData: false }), false);
  assert.equal(hoverVideoAllowed({ finePointer: true, reducedMotion: false, saveData: true }), false);
});
