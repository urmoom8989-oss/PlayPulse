// Uploads that keep going when the storage is busy: a long video is thousands
// of files, and R2 or S3 answer "Please reduce your request rate." when they
// come too fast. Each file is tried again after a wait, and a "slow down"
// pauses every upload for a while, instead of failing a job that took hours.
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { BUFFER_UP_TO, UPLOAD_TRIES, backoffMs, createStorage, isRetryable, isSlowDown } from "../lib/storage.mjs";

const slowDown = () =>
  Object.assign(new Error("Please reduce your request rate."), { name: "SlowDown", $metadata: { httpStatusCode: 503 } });
const denied = () => Object.assign(new Error("Access Denied"), { name: "AccessDenied", $metadata: { httpStatusCode: 403 } });

/** An S3 client that fails the first `failures(key)` puts of each key with `error()`. */
function flakyClient({ failures = () => 0, error = slowDown } = {}) {
  const tries = new Map();
  const stored = new Map();
  return {
    tries,
    stored,
    async send(command, { abortSignal } = {}) {
      if (abortSignal?.aborted) throw Object.assign(new Error("aborted"), { name: "AbortError" });
      const { Key, Body } = command.input;
      const n = (tries.get(Key) ?? 0) + 1;
      tries.set(Key, n);
      if (n <= failures(Key)) throw error();
      const chunks = [];
      for await (const c of Buffer.isBuffer(Body) ? [Body] : Body) chunks.push(c);
      stored.set(Key, Buffer.concat(chunks).toString("utf8"));
      return {};
    },
  };
}

/** A clock that only moves when someone sleeps on it, so the tests take no time. */
function fakeClock() {
  let t = 1_000_000;
  const waits = [];
  return {
    waits,
    now: () => t,
    sleep: async (ms, signal) => {
      if (signal?.aborted) throw signal.reason ?? new Error("aborted");
      waits.push(ms);
      t += ms;
    },
  };
}

async function folder(files) {
  const dir = await mkdtemp(join(tmpdir(), "upload-retry-"));
  for (const [name, text] of Object.entries(files)) await writeFile(join(dir, name), text);
  return dir;
}

test("slow down, a dropped connection and 5xx are tried again; a 403 or an abort is not", () => {
  assert.equal(isSlowDown(slowDown()), true);
  assert.equal(isSlowDown({ $metadata: { httpStatusCode: 429 } }), true);
  assert.equal(isSlowDown(new Error("We encountered an error. Please reduce your request rate.")), true);
  assert.equal(isSlowDown(denied()), false);
  assert.equal(isRetryable(slowDown()), true);
  assert.equal(isRetryable({ $metadata: { httpStatusCode: 500 } }), true);
  assert.equal(isRetryable(Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" })), true);
  assert.equal(isRetryable(new Error("An error was encountered in a non-retryable streaming request.")), true);
  assert.equal(isRetryable(denied()), false);
  assert.equal(isRetryable({ $metadata: { httpStatusCode: 404 } }), false);
  assert.equal(isRetryable(Object.assign(new Error("This operation was aborted"), { name: "AbortError" })), false);
});

test("the wait doubles from half a second and stops growing at 30 seconds", () => {
  const top = () => 1;
  assert.equal(backoffMs(1, top), 500);
  assert.equal(backoffMs(2, top), 1000);
  assert.equal(backoffMs(3, top), 2000);
  assert.equal(backoffMs(20, top), 30_000);
  // The jitter keeps it between half and all of that.
  assert.equal(backoffMs(3, () => 0), 1000);
  for (let n = 1; n < 12; n++) {
    const ms = backoffMs(n);
    assert.ok(ms >= Math.min(30_000, 500 * 2 ** (n - 1)) / 2 && ms <= 30_000, `${n}: ${ms}`);
  }
});

test("a file the storage asks to slow down for is sent again until it goes", async () => {
  const dir = await folder({ "seg_00001.ts": "segment one" });
  try {
    const client = flakyClient({ failures: () => 3 });
    const clock = fakeClock();
    const storage = createStorage(client, "videos", { sleep: clock.sleep, now: clock.now, rand: () => 1 });
    assert.equal(await storage.upload("hls/v/seg_00001.ts", join(dir, "seg_00001.ts")), 11);
    assert.equal(client.tries.get("hls/v/seg_00001.ts"), 4);
    assert.equal(client.stored.get("hls/v/seg_00001.ts"), "segment one");
    // Each try waited longer than the one before.
    assert.ok(clock.waits.length >= 3);
    assert.ok(clock.waits.at(-1) >= clock.waits[0]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a slow down pauses the other uploads too, and the whole folder still gets there", async () => {
  const files = {};
  for (let i = 0; i < 40; i++) files[`seg_${String(i).padStart(5, "0")}.ts`] = `segment ${i}`;
  files["master.m3u8"] = "#EXTM3U";
  const dir = await folder(files);
  try {
    // Every fifth file is refused twice, like a busy bucket.
    const client = flakyClient({ failures: (key) => (/(0|5)\.ts$/.test(key) ? 2 : 0) });
    const clock = fakeClock();
    const storage = createStorage(client, "videos", { sleep: clock.sleep, now: clock.now, rand: () => 1 });
    const seen = [];
    const sent = await storage.uploadDir(dir, "hls/v", { onFile: (n, total) => seen.push([n, total]) });
    assert.equal(sent.files, 41);
    assert.equal(client.stored.size, 41);
    assert.equal(client.stored.get("hls/v/seg_00007.ts"), "segment 7");
    assert.deepEqual(seen.at(-1), [41, 41]);
    // 8 files refused twice each: 16 waits at least.
    assert.ok(clock.waits.length >= 16, `waits: ${clock.waits.length}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("after a slow down, the next upload waits out the pause before it sends", async () => {
  const dir = await folder({ "a.ts": "a", "b.ts": "b" });
  try {
    for (const [error, waits] of [
      [slowDown, [500, 500]],
      // A storage error that is not a slow down retries that file only.
      [() => Object.assign(new Error("InternalError"), { $metadata: { httpStatusCode: 500 } }), [500]],
    ]) {
      const client = flakyClient({ failures: (key) => (key.endsWith("a.ts") ? 1 : 0), error });
      // A clock that stands still, so the pause is still ahead when b starts.
      const seen = [];
      const storage = createStorage(client, "videos", { sleep: async (ms) => void seen.push(ms), now: () => 5_000, rand: () => 1 });
      await storage.upload("hls/v/a.ts", join(dir, "a.ts"));
      await storage.upload("hls/v/b.ts", join(dir, "b.ts"));
      assert.deepEqual(seen, waits);
      assert.equal(client.tries.get("hls/v/b.ts"), 1);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("an error that trying again cannot fix fails at once", async () => {
  const dir = await folder({ "a.ts": "a" });
  try {
    const client = flakyClient({ failures: () => 99, error: denied });
    const clock = fakeClock();
    const storage = createStorage(client, "videos", { sleep: clock.sleep, now: clock.now });
    await assert.rejects(storage.upload("hls/v/a.ts", join(dir, "a.ts")), /Access Denied/);
    assert.equal(client.tries.get("hls/v/a.ts"), 1);
    assert.equal(clock.waits.length, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a storage that never stops refusing fails after UPLOAD_TRIES tries", async () => {
  const dir = await folder({ "a.ts": "a" });
  try {
    const client = flakyClient({ failures: () => 99 });
    const clock = fakeClock();
    const storage = createStorage(client, "videos", { sleep: clock.sleep, now: clock.now });
    await assert.rejects(storage.upload("hls/v/a.ts", join(dir, "a.ts")), /reduce your request rate/);
    assert.equal(client.tries.get("hls/v/a.ts"), UPLOAD_TRIES);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("stopping the job stops the retries", async () => {
  const dir = await folder({ "a.ts": "a" });
  try {
    const stop = new AbortController();
    const client = flakyClient({ failures: () => 99 });
    let waits = 0;
    const storage = createStorage(client, "videos", {
      sleep: async () => {
        if (++waits === 2) stop.abort(new Error("stopped"));
        if (stop.signal.aborted) throw stop.signal.reason;
      },
    });
    await assert.rejects(storage.upload("hls/v/a.ts", join(dir, "a.ts"), stop.signal), /stopped|aborted/);
    assert.ok(client.tries.get("hls/v/a.ts") <= 3);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("small files are sent from memory, so a retry sends the same bytes", async () => {
  assert.equal(BUFFER_UP_TO, 32 * 1024 * 1024);
  const dir = await folder({ "a.ts": "the same bytes" });
  try {
    const bodies = [];
    let n = 0;
    const client = {
      async send(command) {
        bodies.push(command.input.Body);
        if (++n === 1) throw slowDown();
        return {};
      },
    };
    const clock = fakeClock();
    await createStorage(client, "videos", { sleep: clock.sleep, now: clock.now }).upload("hls/v/a.ts", join(dir, "a.ts"));
    assert.equal(bodies.length, 2);
    assert.ok(Buffer.isBuffer(bodies[1]));
    assert.equal(bodies[1].toString(), "the same bytes");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a file that is still refused after all its tries goes again a minute later, without sending the rest twice", async () => {
  const files = {};
  for (let i = 0; i < 12; i++) files[`seg_${i}.ts`] = `segment ${i}`;
  const dir = await folder(files);
  try {
    // seg_3 is refused for a whole round of tries, then the storage calms down.
    const client = flakyClient({ failures: (key) => (key.endsWith("seg_3.ts") ? UPLOAD_TRIES : 0) });
    const clock = fakeClock();
    const storage = createStorage(client, "videos", { sleep: clock.sleep, now: clock.now, rand: () => 1 });
    const rounds = [];
    const sent = await storage.uploadDir(dir, "hls/v", { roundWaitMs: 60_000, onRound: (round, err, left) => rounds.push([round, left]) });
    assert.equal(sent.files, 12);
    assert.equal(client.stored.size, 12);
    // One more round, for seg_3 and the files nobody had started when the round stopped.
    assert.equal(rounds.length, 1);
    assert.equal(rounds[0][0], 1);
    assert.ok(rounds[0][1] >= 1 && rounds[0][1] < 12, `left: ${rounds[0][1]}`);
    assert.ok(clock.waits.includes(60_000));
    assert.equal(client.tries.get("hls/v/seg_3.ts"), UPLOAD_TRIES + 1);
    for (const key of client.stored.keys()) if (!key.endsWith("seg_3.ts")) assert.equal(client.tries.get(key), 1, key);

    // A storage that stays busy for every round fails the upload in the end.
    const stuck = flakyClient({ failures: (key) => (key.endsWith("seg_3.ts") ? Infinity : 0) });
    const stuckStorage = createStorage(stuck, "videos", { sleep: clock.sleep, now: clock.now, rand: () => 1 });
    await assert.rejects(stuckStorage.uploadDir(dir, "hls/v", { rounds: 3 }), /reduce your request rate/);
    assert.equal(stuck.tries.get("hls/v/seg_3.ts"), UPLOAD_TRIES * 3);

    // An error that waiting cannot fix gets no second round.
    const locked = flakyClient({ failures: () => Infinity, error: denied });
    const lockedRounds = [];
    await assert.rejects(
      createStorage(locked, "videos", { sleep: clock.sleep, now: clock.now }).uploadDir(dir, "hls/v", { onRound: () => lockedRounds.push(1) }),
      /Access Denied/,
    );
    assert.deepEqual(lockedRounds, []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
