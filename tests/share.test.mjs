// The share box's buttons (lib/watch/share.ts).
import assert from "node:assert/strict";
import { test } from "node:test";
import { SHARE_TARGETS, opensApp, shareUrl } from "../lib/watch/share.ts";

const LINK = "https://playpulse.example/watch?v=abc&t=30";

test("every button sends the link (and the title where the site takes one)", () => {
  assert.equal(shareUrl("email", LINK, "My vlog"), `mailto:?subject=My%20vlog&body=My%20vlog%20${encodeURIComponent(LINK)}`);
  assert.equal(shareUrl("messages", LINK, "My vlog"), `sms:?&body=My%20vlog%20${encodeURIComponent(LINK)}`);
  assert.equal(shareUrl("whatsapp", LINK, ""), `https://wa.me/?text=${encodeURIComponent(LINK)}`);
  assert.equal(shareUrl("x", LINK, "A & B"), `https://twitter.com/intent/tweet?url=${encodeURIComponent(LINK)}&text=A%20%26%20B`);
  assert.equal(shareUrl("facebook", LINK, "x"), `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(LINK)}`);
  assert.equal(shareUrl("reddit", LINK, "Hi"), `https://www.reddit.com/submit?url=${encodeURIComponent(LINK)}&title=Hi`);
  assert.equal(shareUrl("email", LINK, "  "), `mailto:?subject=A%20video%20for%20you&body=${encodeURIComponent(LINK)}`);
});

test("email and messages open the device's app; the others a new tab", () => {
  assert.deepEqual(SHARE_TARGETS.filter((t) => opensApp(t.key)).map((t) => t.key), ["email", "messages"]);
  assert.equal(SHARE_TARGETS.length, 6);
});
