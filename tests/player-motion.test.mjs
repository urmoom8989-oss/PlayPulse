// Player motion: the play/pause fold (lib/watch/morph.ts).
import assert from "node:assert/strict";
import { test } from "node:test";
import { PLAY_MORPH_MS, morphEase, playPauseShape } from "../lib/watch/morph.ts";

const points = (d) => [...d.matchAll(/(-?[\d.]+),(-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);

test("0 is two pause bars, 1 is the play triangle in two halves", () => {
  assert.equal(playPauseShape(0), "M12,26 16,26 16,10 12,10z M20,26 24,26 24,10 20,10z");
  assert.equal(playPauseShape(1), "M12,26 18.5,22 18.5,14 12,10z M18.5,22 25,18 25,18 18.5,14z");
});

test("both shapes have the same eight points, so they fold into each other", () => {
  for (const p of [0, 0.25, 0.5, 0.75, 1]) assert.equal(points(playPauseShape(p)).length, 8, String(p));
});

test("half way is half way between, point by point", () => {
  const a = points(playPauseShape(0));
  const b = points(playPauseShape(1));
  const mid = points(playPauseShape(0.5));
  mid.forEach(([x, y], i) => {
    assert.ok(Math.abs(x - (a[i][0] + b[i][0]) / 2) <= 0.01, `x of point ${i}`);
    assert.ok(Math.abs(y - (a[i][1] + b[i][1]) / 2) <= 0.01, `y of point ${i}`);
  });
});

test("out of range and broken values stay on a real shape", () => {
  assert.equal(playPauseShape(-3), playPauseShape(0));
  assert.equal(playPauseShape(7), playPauseShape(1));
  assert.equal(playPauseShape(Number.NaN), playPauseShape(0));
});

test("the easing starts at 0, ends at 1 and never goes back", () => {
  assert.equal(morphEase(0), 0);
  assert.equal(morphEase(1), 1);
  assert.equal(morphEase(0.5), 0.5);
  let last = 0;
  for (let t = 0; t <= 1.0001; t += 0.05) {
    const v = morphEase(Math.min(1, t));
    assert.ok(v >= last - 1e-12, `at ${t}`);
    last = v;
  }
  assert.equal(PLAY_MORPH_MS, 200);
});
