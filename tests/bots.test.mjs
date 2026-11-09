// 030_bots.sql: bots only for channels with bots_on, closed to the API.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

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
