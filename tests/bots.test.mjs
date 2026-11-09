// 030_bots.sql: bots only for channels with bots_on, closed to the API; 034_bot_panel.sql
// and the studio's Bots page: bots only where the owner orders them.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { MAX_AMOUNT, amountOf, amountsText, botErrorCode, botStatus, orderPercent, orderProblem, orderStatusText, readPanel, suggestFor, windowText } from "../lib/bots/rules.ts";

const sql = readFileSync(new URL("../supabase/migrations/030_bots.sql", import.meta.url), "utf8");

test("030: only @typicalgamer gets bots, the tables are closed to the API", () => {
  assert.match(sql, /update public\.channels set bots_on = true where lower\(handle\) = 'typicalgamer'/);
  for (const t of ["bot_accounts", "bot_settings"]) {
    assert.match(sql, new RegExp(`alter table public\\.${t} enable row level security`));
    assert.match(sql, new RegExp(`revoke all on public\\.${t} from anon, authenticated`));
  }
  assert.match(sql, /raise exception 'not_a_bot_video'/);
});

test("030: every bot function is for the worker only, and the flag starts off", () => {
  const fns = [...sql.matchAll(/create function public\.(bot_[a-z_]+)\(/g)].map((m) => m[1]);
  assert.ok(fns.length >= 10);
  for (const fn of fns) assert.ok(sql.includes(`'public.${fn}(`), `${fn} is in the revoke list`);
  assert.match(sql, /revoke execute on function %s from public, anon, authenticated/);
  assert.match(sql, /grant execute on function %s to service_role/);
  assert.match(sql, /'bots',[\s\S]*?'off'/);
});


const sql34 = readFileSync(new URL("../supabase/migrations/034_bot_panel.sql", import.meta.url), "utf8");

test("034: orders are closed to the API; owners use the panel functions, the worker the rest", () => {
  for (const t of ["bot_orders", "bot_live"]) {
    assert.match(sql34, new RegExp(`alter table public\\.${t} enable row level security`));
    assert.match(sql34, new RegExp(`revoke all on public\\.${t} from anon, authenticated`));
  }
  for (const fn of ["bot_panel()", "bot_order_add(uuid, int, int, int, int, int, int)", "bot_order_cancel(uuid)", "bot_live_set(uuid, boolean)"]) {
    assert.ok(sql34.includes(`'public.${fn}'`), fn);
  }
  for (const fn of ["bot_due_orders()", "bot_order_delivered(uuid, int, int, int, int, int, boolean)", "bot_subscribe_to(uuid, int)", "bot_grow(int)", "bot_pool()", "bot_live_targets()", "bot_post_comment(uuid, text)"]) {
    assert.ok(sql34.includes(`'public.${fn}'`), fn);
  }
  assert.match(sql34, /grant execute on function %s to authenticated/);
  assert.match(sql34, /grant execute on function %s to service_role/);
  // The owner's channel needs bots_on and the bots flag.
  assert.match(sql34, /not ch\.bots_on/);
  assert.match(sql34, /feature_on\('bots', me\)/);
  // The automatic rounds of 030 find nothing now.
  assert.match(sql34, /create function public\.bot_targets\(\)[\s\S]*?where false/);
  assert.match(sql34, /create or replace function public\.bot_subscribe\(n int\)[\s\S]*?select 0/);
  assert.match(sql34, /select 10000/);
});

test("035: all at once in the same call, no limits but what an int holds", () => {
  const sql35 = readFileSync(new URL("../supabase/migrations/035_bots_at_once.sql", import.meta.url), "utf8");
  assert.match(sql35, /if w = 0 then\s+perform public\.bot_deliver\(new_id/);
  assert.match(sql35, /not between 0 and 2000000000/);
  assert.doesNotMatch(sql35, /not between 0 and (1000000|10000|1000)\b/);
  assert.match(sql35, /grant execute on function public\.bot_deliver\(uuid, bigint, bigint, bigint, bigint\) to service_role/);
  assert.match(sql35, /revoke execute on function public\.bot_deliver\(uuid, bigint, bigint, bigint, bigint\) from public, anon, authenticated/);
  // The first 20,000 views of an order are full views; the rest go on the count.
  assert.match(sql35, /20000 - o\.done_views/);
  assert.equal(MAX_AMOUNT, 2_000_000_000);
});

test("the panel's limits and words", () => {
  const ok = { views: 1000, likes: 45, dislikes: 2, comments: 4, subscribers: 0, videoId: "v", overMinutes: 1440 };
  assert.equal(orderProblem(ok), null);
  // No limit of our own: a billion views is fine, only past what the database holds is not.
  assert.equal(orderProblem({ ...ok, views: 1_000_000_000, likes: 50_000_000, subscribers: 5_000_000 }), null);
  assert.equal(orderProblem({ ...ok, views: MAX_AMOUNT + 1 }), "bad_amount");
  assert.equal(orderProblem({ ...ok, overMinutes: 30 }), "bad_window");
  assert.equal(orderProblem({ ...ok, views: 0, likes: 0, dislikes: 0, comments: 0 }), "empty_order");
  assert.equal(orderProblem({ views: 0, likes: 0, dislikes: 0, comments: 0, subscribers: 50, videoId: null, overMinutes: 0 }), null);
  assert.equal(orderProblem({ ...ok, videoId: null }), "not_found");
  assert.equal(amountOf("1,000"), 1000);
  assert.equal(amountOf(""), 0);
  assert.equal(amountOf("-5"), 0);
  assert.deepEqual(suggestFor(1000), { likes: 45, dislikes: 2, comments: 4 });
  assert.equal(amountsText({ views: 1000, likes: 45, comments: 1 }), "1,000 views, 45 likes and 1 comment");
  assert.equal(amountsText({ subscribers: 20 }), "20 subscribers");
  assert.equal(windowText("2026-11-09T00:00:00Z", "2026-11-10T00:00:00Z"), "Over 24 hours");
  assert.equal(windowText("2026-11-09T00:00:00Z", "2026-11-09T00:00:00Z"), "All at once");
  const amounts = { views: 100, likes: 0, dislikes: 0, comments: 0, subscribers: 0 };
  assert.equal(orderPercent({ amounts, done: { ...amounts, views: 25 } }), 25);
  const now = Date.parse("2026-11-09T12:00:00Z");
  assert.match(orderStatusText({ status: "active", amounts, done: { ...amounts, views: 25 }, endsAt: "2026-11-09T14:30:00Z" }, now), /^25% delivered, about 2 h 30 min to go$/);
  assert.equal(orderStatusText({ status: "done", amounts, done: amounts, endsAt: "" }, now), "Delivered");
  assert.equal(botErrorCode("too_many_orders"), "too_many_orders");
  assert.equal(botErrorCode("something else"), "failed");
  assert.equal(botStatus("bots_off"), 403);
  assert.equal(botStatus("failed"), 500);
});

test("bot_panel()'s answer as the page reads it", () => {
  assert.equal(readPanel(null), null);
  assert.equal(readPanel([]), null);
  const p = readPanel({
    channel: { id: "c", handle: "typicalgamer", name: "Typical Gamer", subscribers: 12, pool: 300, pool_max: 10000 },
    videos: [{ id: "v", title: "T", visibility: "unlisted", views: "5", comments_mode: "held", broadcast_kind: "live", broadcast_at: "2026-11-09T00:00:00Z", live_bots: true }],
    orders: [{ id: "o", video_id: null, subscribers: 20, done_subscribers: 5, status: "active", starts_at: "a", ends_at: "b" }],
  });
  assert.equal(p.channel.handle, "typicalgamer");
  assert.equal(p.videos[0].visibility, "unlisted");
  assert.equal(p.videos[0].views, 5);
  assert.equal(p.videos[0].commentsMode, "held");
  assert.equal(p.videos[0].liveBots, true);
  assert.equal(p.orders[0].amounts.subscribers, 20);
  assert.equal(p.orders[0].done.subscribers, 5);
  assert.equal(p.orders[0].videoId, null);
});
