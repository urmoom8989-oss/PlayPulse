// Scheduled videos (042): the worker's minute round, with the database faked.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createDb } from "../lib/db.mjs";
import { publishRound, runScheduler } from "../lib/schedule.mjs";

/** A Supabase client whose rpc answers from the given list in turn. */
function fakeSupabase(answers) {
  const calls = [];
  return {
    calls,
    rpc: async (name, args) => {
      calls.push({ name, args });
      return answers[Math.min(calls.length - 1, answers.length - 1)];
    },
  };
}

const logs = () => {
  const l = [];
  const fn = (...a) => void l.push(a);
  fn.list = l;
  return fn;
};

test("publishScheduled returns the number of videos that went public", async () => {
  const sb = fakeSupabase([{ data: 2, error: null }]);
  assert.equal(await createDb(sb).publishScheduled(), 2);
  assert.deepEqual(sb.calls, [{ name: "publish_scheduled", args: undefined }]);
});

test("publishScheduled is null before 042 and throws on other errors", async () => {
  assert.equal(await createDb(fakeSupabase([{ data: null, error: { code: "PGRST202", message: "not found" } }])).publishScheduled(), null);
  assert.equal(await createDb(fakeSupabase([{ data: null, error: { code: "42883", message: "no function" } }])).publishScheduled(), null);
  await assert.rejects(createDb(fakeSupabase([{ data: null, error: { code: "57014", message: "timeout" } }])).publishScheduled(), /publish_scheduled: timeout/);
});

test("a round logs only when videos went public", async () => {
  const log = logs();
  assert.equal(await publishRound({ db: { publishScheduled: async () => 0 }, log }), 0);
  assert.equal(log.list.length, 0);
  assert.equal(await publishRound({ db: { publishScheduled: async () => 3 }, log }), 3);
  assert.match(log.list[0][2], /3 scheduled videos went public/);
});

test("the scheduler keeps going after a failed round, waits longer before 042, and stops", async () => {
  const stop = new AbortController();
  const answers = [new Error("connect ECONNREFUSED"), null, 1];
  let calls = 0;
  const db = {
    publishScheduled: async () => {
      const a = answers[calls++];
      if (calls >= answers.length) stop.abort();
      if (a instanceof Error) throw a;
      return a;
    },
  };
  const log = logs();
  await runScheduler({ db, log, stopSignal: stop.signal, everyMs: 1, missingEveryMs: 2 });
  assert.equal(calls, 3);
  const text = log.list.map((l) => l[2]).join("\n");
  assert.match(text, /round failed: connect ECONNREFUSED/);
  assert.match(text, /042_upload_options.sql is not run yet/);
  assert.match(text, /1 scheduled video went public/);
});

test("the scheduler does nothing without publishScheduled", async () => {
  await runScheduler({ db: {}, log: logs(), stopSignal: new AbortController().signal });
});
