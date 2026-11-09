// Sources come down in pieces, a few at a time, and a piece whose connection
// drops is fetched again on its own (storage.download with a size).
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { test } from "node:test";
import { DOWNLOAD_TRIES, createStorage, isRetryableDownload } from "../lib/storage.mjs";

const SOURCE = Buffer.from("abcdefghijklmnopqrstuvwxyz0123456789");
const dropped = () => Object.assign(new Error("aborted"), { code: "ECONNRESET" });
const denied = () => Object.assign(new Error("Access Denied"), { name: "AccessDenied", $metadata: { httpStatusCode: 403 } });

/**
 * An S3 client serving SOURCE by range in 4 byte chunks. `fail(start, n)`
 * can break the nth try of the piece that starts at `start`: "before" throws
 * at once, "midway" sends one chunk and then drops.
 */
function rangeClient({ fail = () => null } = {}) {
  const tries = new Map();
  let open = 0;
  const client = {
    tries,
    most: 0,
    async send(command, { abortSignal } = {}) {
      if (abortSignal?.aborted) throw Object.assign(new Error("stopped"), { name: "AbortError" });
      const [, a, b] = /bytes=(\d+)-(\d+)/.exec(command.input.Range);
      const start = Number(a);
      const end = Number(b);
      const n = (tries.get(start) ?? 0) + 1;
      tries.set(start, n);
      const how = fail(start, n);
      if (how === "before") throw dropped();
      if (how === "denied") throw denied();
      const bytes = SOURCE.subarray(start, end + 1);
      const chunks = [];
      for (let i = 0; i < bytes.length; i += 4) chunks.push(bytes.subarray(i, i + 4));
      open++;
      client.most = Math.max(client.most, open);
      async function* body() {
        try {
          for (const [i, c] of chunks.entries()) {
            await new Promise((r) => setTimeout(r, 1));
            if (how === "midway" && i === 1) throw dropped();
            yield c;
          }
        } finally {
          open--;
        }
      }
      return { Body: Readable.from(body()) };
    },
  };
  return client;
}

const noWait = { sleep: async () => {}, rand: () => 0 };

async function inTemp(fn) {
  const dir = await mkdtemp(join(tmpdir(), "download-"));
  try {
    return await fn(join(dir, "source"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("a big source comes down in pieces, a few at a time, and lands whole", async () => {
  const client = rangeClient();
  const storage = createStorage(client, "videos-test", noWait);
  await inTemp(async (path) => {
    const seen = [];
    await storage.download("k", path, undefined, (got) => seen.push(got), { size: SOURCE.length, partBytes: 10, parallel: 2 });
    assert.deepEqual(await readFile(path), SOURCE);
    assert.deepEqual([...client.tries.keys()].sort((x, y) => x - y), [0, 10, 20, 30]);
    assert.equal(client.most, 2, "two pieces at a time");
    assert.equal(seen.at(-1), SOURCE.length);
  });
});

test("a piece whose connection drops is fetched again on its own", async () => {
  const client = rangeClient({ fail: (start, n) => (start === 10 && n === 1 ? "midway" : start === 20 && n <= 2 ? "before" : null) });
  const storage = createStorage(client, "videos-test", noWait);
  await inTemp(async (path) => {
    const seen = [];
    await storage.download("k", path, undefined, (got) => seen.push(got), { size: SOURCE.length, partBytes: 10, parallel: 3 });
    assert.deepEqual(await readFile(path), SOURCE);
    assert.equal(client.tries.get(0), 1);
    assert.equal(client.tries.get(10), 2);
    assert.equal(client.tries.get(20), 3);
    // The count goes back for the piece that started over, and ends at the size.
    assert.equal(seen.at(-1), SOURCE.length);
    assert.ok(Math.max(...seen) <= SOURCE.length);
  });
});

test("a refusal fails at once, and a piece that keeps dropping fails after DOWNLOAD_TRIES", async () => {
  await inTemp(async (path) => {
    const client = rangeClient({ fail: (start) => (start === 10 ? "denied" : null) });
    await assert.rejects(
      createStorage(client, "videos-test", noWait).download("k", path, undefined, null, { size: SOURCE.length, partBytes: 10, parallel: 2 }),
      /Access Denied/,
    );
    assert.equal(client.tries.get(10), 1);
  });
  await inTemp(async (path) => {
    const client = rangeClient({ fail: (start) => (start === 0 ? "before" : null) });
    await assert.rejects(
      createStorage(client, "videos-test", noWait).download("k", path, undefined, null, { size: SOURCE.length, partBytes: 10, parallel: 1 }),
      /aborted/,
    );
    assert.equal(client.tries.get(0), DOWNLOAD_TRIES);
  });
});

test("stopping the job stops the download", async () => {
  const stop = new AbortController();
  const client = rangeClient({ fail: (start) => (start === 10 ? (stop.abort(new Error("the worker was stopped")), "before") : null) });
  await inTemp(async (path) => {
    await assert.rejects(
      createStorage(client, "videos-test", noWait).download("k", path, stop.signal, null, { size: SOURCE.length, partBytes: 10, parallel: 1 }),
      /the worker was stopped/,
    );
    assert.equal(client.tries.has(20), false);
  });
});

test("which download errors are worth another try", () => {
  assert.equal(isRetryableDownload(dropped()), true);
  assert.equal(isRetryableDownload(Object.assign(new Error("x"), { $metadata: { httpStatusCode: 503 } })), true);
  assert.equal(isRetryableDownload(Object.assign(new Error("x"), { $metadata: { httpStatusCode: 429 } })), true);
  assert.equal(isRetryableDownload(denied()), false);
  assert.equal(isRetryableDownload(Object.assign(new Error("x"), { $metadata: { httpStatusCode: 404 } })), false);
  const stopped = new AbortController();
  stopped.abort();
  assert.equal(isRetryableDownload(dropped(), stopped.signal), false);
});
