// R2 through its S3 API: read the source, write the HLS files, empty the
// folders of purged videos.
import { createReadStream, createWriteStream } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

/**
 * An S3 client for the video bucket: the account's R2 endpoint (same settings
 * as lib/upload/r2.ts in the app), or any S3 compatible endpoint when one is
 * given (a Railway bucket, for example).
 */
export function createR2Client({ accountId, accessKeyId, secretAccessKey, endpoint, region = "auto", forcePathStyle = true }) {
  return new S3Client({
    region,
    endpoint: endpoint || `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle,
    // Long videos are thousands of files: when the storage says "slow down",
    // the SDK backs off and paces itself instead of failing (adaptive mode).
    maxAttempts: 6,
    retryMode: "adaptive",
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
}

const TYPES = {
  m3u8: "application/vnd.apple.mpegurl",
  m4s: "video/iso.segment",
  mp4: "video/mp4",
  webp: "image/webp",
  vtt: "text/vtt; charset=utf-8",
};

export function contentTypeFor(name) {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return TYPES[ext] ?? "application/octet-stream";
}

/** Everything under hls/<video>/ is written once per encode. Playlists can change on a re-encode, segments cannot. */
export function cacheControlFor(name) {
  if (/\.(m4s|mp4)$/.test(name)) return "public, max-age=31536000, immutable";
  // The master playlist changes when HD (038) and captions are added: a minute, not five.
  if (/(^|\/)master\.m3u8$/.test(name)) return "public, max-age=60";
  return "public, max-age=300";
}

/** The R2 folder for a video's encoded files. */
export function hlsPrefix(videoId) {
  return `hls/${videoId}`;
}

/** Every file below dir, as paths relative to it with forward slashes, sorted. */
export async function listFiles(dir) {
  const out = [];
  const walk = async (d) => {
    for (const entry of await readdir(d, { withFileTypes: true })) {
      const full = join(d, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) out.push(relative(dir, full).split(sep).join("/"));
    }
  };
  await walk(dir);
  return out.sort();
}

/** Files up to this size are sent from memory, so a failed request can be sent again as is. */
export const BUFFER_UP_TO = 32 * 1024 * 1024;
/** Each file gets this many tries when the storage is busy or the network drops. */
export const UPLOAD_TRIES = 10;

/** Is this the storage asking us to send less ("Please reduce your request rate", 503, 429)? */
export function isSlowDown(err) {
  const status = err?.$metadata?.httpStatusCode;
  return (
    status === 429 ||
    status === 503 ||
    /SlowDown|Throttl|TooManyRequests/i.test(`${err?.name ?? ""} ${err?.Code ?? ""}`) ||
    /reduce your request rate/i.test(String(err?.message ?? ""))
  );
}

/** Errors worth trying again: slow down, the storage's own 5xx, the network dropping. Never an abort. */
export function isRetryable(err) {
  if (err?.name === "AbortError") return false;
  const status = err?.$metadata?.httpStatusCode;
  if (isSlowDown(err) || status === 500 || status === 502 || status === 504) return true;
  return /RequestTimeout|InternalError|ServiceUnavailable|ECONNRESET|ETIMEDOUT|EPIPE|EAI_AGAIN|socket hang up|non-retryable streaming request/i.test(
    `${err?.name ?? ""} ${err?.code ?? ""} ${err?.message ?? ""}`,
  );
}

/** The wait before try n + 1: half a second doubling to at most 30 seconds, with jitter. */
export function backoffMs(n, rand = Math.random) {
  const base = Math.min(30_000, 500 * 2 ** Math.max(0, n - 1));
  return Math.round(base / 2 + (rand() * base) / 2);
}

/** Resolves after ms, or rejects when the signal aborts. */
function wait(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason ?? new Error("aborted"));
    let t;
    const stop = () => {
      clearTimeout(t);
      reject(signal.reason ?? new Error("aborted"));
    };
    t = setTimeout(() => {
      signal?.removeEventListener("abort", stop);
      resolve();
    }, ms);
    signal?.addEventListener("abort", stop, { once: true });
  });
}

function isNotFound(err) {
  return err?.$metadata?.httpStatusCode === 404 || err?.name === "NotFound" || err?.name === "NoSuchKey";
}

/**
 * The storage the job needs, on top of an S3 client and one bucket. `sleep`,
 * `now` and `rand` are for the tests.
 */
export function createStorage(client, bucket, { sleep = wait, now = Date.now, rand = Math.random } = {}) {
  // When the storage asks one upload to slow down, every upload waits until then.
  let pausedUntil = 0;
  return {
    /** The object's size in bytes, or null when it does not exist. */
    async headSize(key, signal) {
      try {
        const out = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }), { abortSignal: signal });
        return typeof out.ContentLength === "number" ? out.ContentLength : null;
      } catch (err) {
        if (isNotFound(err)) return null;
        throw err;
      }
    },

    /** A small object as text (captions for the bots), or null when it does not exist. */
    async getText(key, signal) {
      try {
        const out = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }), { abortSignal: signal });
        return out.Body ? await out.Body.transformToString("utf-8") : null;
      } catch (err) {
        if (isNotFound(err)) return null;
        throw err;
      }
    },

    async download(key, path, signal) {
      const out = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }), { abortSignal: signal });
      if (!out.Body) throw new Error("R2 sent no body");
      await pipeline(out.Body, createWriteStream(path), { signal });
    },

    /**
     * Writes one file. Small files go from memory; when the storage is busy
     * (or the network drops) the file is sent again after a growing wait, up
     * to UPLOAD_TRIES times, and a "slow down" pauses every upload a while.
     */
    async upload(key, path, signal) {
      const { size } = await stat(path);
      const buffered = size <= BUFFER_UP_TO ? await readFile(path) : null;
      for (let attempt = 1; ; attempt++) {
        const ahead = pausedUntil - now();
        if (ahead > 0) await sleep(ahead, signal);
        try {
          await client.send(
            new PutObjectCommand({
              Bucket: bucket,
              Key: key,
              Body: buffered ?? createReadStream(path),
              ContentLength: size,
              ContentType: contentTypeFor(key),
              CacheControl: cacheControlFor(key),
            }),
            { abortSignal: signal },
          );
          return size;
        } catch (err) {
          if (signal?.aborted || attempt >= UPLOAD_TRIES || !isRetryable(err)) throw err;
          const delay = backoffMs(attempt, rand);
          // A slow down pauses every upload (the wait at the top of the loop);
          // any other error only makes this file wait.
          if (isSlowDown(err)) pausedUntil = Math.max(pausedUntil, now() + delay);
          else await sleep(delay, signal);
        }
      }
    },

    /**
     * Uploads every file in dir under prefix/, six at a time (each retried as
     * upload() does). When a file still fails with an error worth trying again,
     * the files not sent yet go again after roundWaitMs, up to `rounds` times,
     * so hours of encoding are not thrown away for a busy minute. Returns the
     * count and bytes.
     */
    async uploadDir(
      dir,
      prefix,
      { signal, concurrency = 6, rounds = 3, roundWaitMs = 60_000, onFile = () => {}, onRound = () => {} } = {},
    ) {
      const files = await listFiles(dir);
      const done = new Set();
      let bytes = 0;
      for (let round = 1; ; round++) {
        const todo = files.filter((name) => !done.has(name));
        let next = 0;
        let failed = null;
        const one = async () => {
          while (!failed && next < todo.length) {
            const name = todo[next++];
            try {
              signal?.throwIfAborted();
              bytes += await this.upload(`${prefix}/${name}`, join(dir, name), signal);
              done.add(name);
              onFile(done.size, files.length);
            } catch (err) {
              failed ??= err;
            }
          }
        };
        await Promise.all(Array.from({ length: Math.min(concurrency, todo.length) }, one));
        if (!failed) return { files: files.length, bytes };
        if (signal?.aborted || round >= rounds || !isRetryable(failed)) throw failed;
        onRound(round, failed, files.length - done.size);
        await sleep(roundWaitMs, signal);
      }
    },

    /** Deletes every object under prefix, a page of up to 1000 at a time. Returns how many. */
    async deletePrefix(prefix, signal) {
      let deleted = 0;
      for (let round = 0; round < 1000; round++) {
        signal?.throwIfAborted();
        // Always the first page: what was deleted is gone, so the next page is the rest.
        const page = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, MaxKeys: 1000 }), { abortSignal: signal });
        const keys = (page.Contents ?? []).map((o) => o.Key).filter((k) => typeof k === "string" && k.startsWith(prefix));
        if (keys.length === 0) return deleted;
        const out = await client.send(
          new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true } }),
          { abortSignal: signal },
        );
        if (out.Errors?.length) throw new Error(`R2 kept ${out.Errors.length} objects: ${out.Errors[0].Message ?? out.Errors[0].Code}`);
        deleted += keys.length;
      }
      throw new Error("too many objects under the prefix");
    },
  };
}
