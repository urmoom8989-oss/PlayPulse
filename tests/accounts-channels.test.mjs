// Several accounts on one browser (Switch account) and optional channels (036).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { MAX_SAVED, accountError, isAuthCookie, parseSaved, serializeSaved, withSaved, withoutSaved } from "../lib/accounts/saved-rules.ts";
import { rowToComment } from "../lib/comments/types.ts";

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

test("the waiting accounts cookie: round trip, and anything odd is dropped", () => {
  const list = [
    { id: id(1), rt: "rt-one", email: "a@example.com" },
    { id: id(2), rt: "rt-two", email: null },
  ];
  assert.deepEqual(parseSaved(serializeSaved(list)), list);
  assert.deepEqual(parseSaved(""), []);
  assert.deepEqual(parseSaved("not base64 json"), []);
  assert.deepEqual(parseSaved(Buffer.from(JSON.stringify({ id: id(1) })).toString("base64url")), []);
  const odd = Buffer.from(JSON.stringify([{ id: "nope", rt: "x" }, { id: id(3), rt: "" }, { id: id(4).toUpperCase(), rt: "ok" }, { id: id(4), rt: "again" }])).toString("base64url");
  assert.deepEqual(parseSaved(odd), [{ id: id(4), rt: "ok", email: null }]);
});

test("the account in use goes first; the same account is never there twice; at most MAX_SAVED", () => {
  let list = [];
  for (let n = 1; n <= MAX_SAVED + 3; n++) list = withSaved(list, { id: id(n), rt: `rt${n}`, email: null });
  assert.equal(list.length, MAX_SAVED);
  assert.equal(list[0].id, id(MAX_SAVED + 3));
  list = withSaved(list, { id: id(MAX_SAVED + 1), rt: "newer", email: null });
  assert.equal(list[0].rt, "newer");
  assert.equal(list.filter((s) => s.id === id(MAX_SAVED + 1)).length, 1);
  assert.equal(withoutSaved(list, id(MAX_SAVED + 1)).length, MAX_SAVED - 1);
});

test("only Supabase's session cookies are dropped when adding an account", () => {
  assert.equal(isAuthCookie("sb-abcdefgh-auth-token"), true);
  assert.equal(isAuthCookie("sb-abcdefgh-auth-token.0"), true);
  assert.equal(isAuthCookie("sb-abcdefgh-auth-token-code-verifier"), false);
  assert.equal(isAuthCookie("pp_accounts"), false);
  assert.equal(isAuthCookie("pp_lang"), false);
  assert.match(accountError("signed_out"), /Add account/);
  assert.equal(accountError("whatever"), "Something went wrong. Try again.");
});

test("a comment by an account without a channel shows its name, without a link", () => {
  const row = {
    id: "c", video_id: "v", parent_id: null, body: "hi", like_count: 0, reply_count: 0, pinned: false, hearted: false,
    created_at: "2026-11-09T00:00:00Z", edited_at: null, deleted: false, author_handle: null, author_name: "Jake Miller",
    author_avatar_url: null, by_owner: false, mine: false, liked: false,
  };
  assert.deepEqual(rowToComment(row).author, { handle: null, name: "Jake Miller", avatarUrl: null });
  assert.deepEqual(rowToComment({ ...row, author_handle: "jake" }).author, { handle: "jake", name: "Jake Miller", avatarUrl: null });
  assert.equal(rowToComment({ ...row, deleted: true, author_name: null }).author, null);
});

test("036: no channel at sign up with the flag, none for bots, Create a channel once", () => {
  const sql = readFileSync(new URL("../supabase/migrations/036_optional_channels.sql", import.meta.url), "utf8");
  assert.match(sql, /f\.key = 'optional_channels' and f\.mode = 'everyone'/);
  assert.match(sql, /u\.email like 'bot-%@users\.invalid'/);
  assert.match(sql, /delete from public\.channels c\s+using public\.bot_accounts b/);
  assert.match(sql, /not exists \(select 1 from public\.videos v where v\.channel_id = c\.id\)/);
  assert.match(sql, /raise exception 'has_channel'/);
  assert.match(sql, /grant execute on function public\.create_my_channel\(text, text\) to authenticated/);
  assert.match(sql, /revoke execute on function public\.create_my_channel\(text, text\) from public, anon/);
  assert.match(sql, /case when c\.deleted_at is null then ch\.handle end as author_handle/);
  assert.match(sql, /'optional_channels',[\s\S]*?'off'/);
});
