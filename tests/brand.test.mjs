// The PlayPulse mark: one drawing everywhere, and nothing borrowed from another platform.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { BRAND, MARK_LINE, logoSvg, markSvg } from "../lib/brand.ts";
import { maintenanceHtml } from "../lib/launch/maintenance.ts";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("the maintenance page draws the same mark as lib/brand.ts", () => {
  const html = maintenanceHtml("PlayPulse");
  assert.ok(html.includes(MARK_LINE), "line path in step");
  assert.ok(html.includes(BRAND.mark), "brand teal in step");
});

test("the press kit SVGs are the ones lib/brand.ts draws", () => {
  assert.equal(read("public/press/playpulse-logo.svg").trim(), logoSvg());
  assert.equal(read("public/press/playpulse-mark.svg").trim(), markSvg(240));
});

test("globals.css uses the brand colors for the mark and the word", () => {
  const css = read("app/globals.css");
  assert.ok(css.includes(`--mark: ${BRAND.mark};`));
  assert.ok(css.includes(`--logo-word: ${BRAND.word};`));
});

test("no YouTube red in the marks", () => {
  for (const svg of [logoSvg(), markSvg(), read("components/icons.tsx"), maintenanceHtml("x")]) {
    assert.doesNotMatch(svg, /#ff0000|#cc0000/i);
  }
});

test("the mark is one stroked line: a heartbeat into a play triangle, no fill", () => {
  const svg = markSvg(24);
  assert.match(svg, /fill="none"/);
  assert.match(svg, /stroke-linejoin="round"/);
  assert.doesNotMatch(svg, /<rect|<circle/);
  assert.equal((MARK_LINE.match(/M/g) ?? []).length, 3, "beat, triangle, line out");
});
