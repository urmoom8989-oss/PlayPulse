// The logic behind /api/upload/sign, /api/upload/complete and /api/upload/abort.
// The route files only wire in the real S3 storage, the Supabase calls and the
// signed in user, so the tests can run all of this with fakes.
// Only relative imports, so Node can load this file directly in the tests.

import {
  PART_SIZE,
  PART_URL_TTL_S,
  detailsProblem,
  fileProblemCode,
  isUuid,
  keyBelongsTo,
  planParts,
  uploadErrorText,
  type Details,
  type VideoCategory,
} from "./rules.ts";
import {
  THUMBNAIL_MAX_BYTES,
  THUMBNAIL_TYPES,
  customThumbnailName,
  isThumbnailName,
  thumbnailKey,
} from "../studio/rules.ts";

export type CompletedPart = { partNumber: number; etag: string };

/** What the routes need from storage. lib/upload/s3.ts implements it with the S3 API. */
export type UploadStorage = {
  createMultipart(key: string, mime: string): Promise<string>;
  presignPart(key: string, uploadId: string, partNumber: number, expiresIn: number): Promise<string>;
  completeMultipart(key: string, uploadId: string, parts: CompletedPart[]): Promise<void>;
  abortMultipart(key: string, uploadId: string): Promise<void>;
  /** The object's size in bytes, or null when it does not exist. */
  objectSize(key: string): Promise<number | null>;
  presignThumbnail(key: string, mime: string): Promise<string>;
  thumbnailInfo(key: string): Promise<{ bytes: number; type: string | null } | null>;
  deleteObject(key: string): Promise<void>;
};

export type VideoRow = {
  id: string;
  ownerId: string;
  status: string;
  sourceKey: string | null;
  sourceBytes: number | null;
  sourceMime: string | null;
};

/** An error code from the database (see the RPCs in 005_videos.sql), or null. */
export type DbError = string | null;

/** What the routes need from the database. lib/upload/db.ts implements it with Supabase. */
export type UploadDb = {
  createUpload(title: string, bytes: number, mime: string): Promise<{ videoId: string; key: string } | { error: string }>;
  getVideo(id: string): Promise<VideoRow | null>;
  saveDetails(id: string, details: Details): Promise<DbError>;
  saveThumbnail(id: string, name: string, url: string | null): Promise<DbError>;
  finishUpload(id: string): Promise<DbError>;
  publishVideo(id: string): Promise<DbError>;
  abandonUpload(id: string, reason: string): Promise<DbError>;
};

export type UploadContext = {
  /** null when object-storage settings are missing. */
  storage: UploadStorage | null;
  /** null when the Supabase settings are missing. */
  db: UploadDb | null;
  /** The signed in user id, or null. */
  userId: () => Promise<string | null>;
  flagOn: (userId: string) => Promise<boolean>;
};

export type HandlerResult = { status: number; body: Record<string, unknown> };

function fail(status: number, code: string): HandlerResult {
  return { status, body: { error: code, message: uploadErrorText(code) } };
}

/** POST /api/upload/publish { videoId }: an explicit public publish action. */
export async function publishUpload(rawBody: unknown, ctx: UploadContext): Promise<HandlerResult> {
  const g = await gate(ctx);
  if (!g.ok) return g.result;
  const videoId = asRecord(rawBody).videoId;
  if (!isUuid(videoId)) return fail(400, "bad_video_id");
  const video = await g.db.getVideo(videoId);
  if (!video || video.ownerId !== g.userId) return fail(404, "not_found");
  if (!video.sourceKey || !keyBelongsTo(video.sourceKey, g.userId)) return fail(404, "not_found");
  if (video.status !== "uploaded" && video.status !== "processing" && video.status !== "ready") {
    return fail(409, video.status === "uploading" ? "not_uploading" : "not_ready");
  }
  const error = await g.db.publishVideo(videoId);
  if (error) return fail(statusForCode(error), error);
  return { status: 200, body: { videoId, visibility: "public" } };
}

/** POST /api/upload/thumbnail/sign { videoId, mime, bytes }. */
export async function signUploadThumbnail(rawBody: unknown, ctx: UploadContext): Promise<HandlerResult> {
  const g = await gate(ctx);
  if (!g.ok) return g.result;
  const body = asRecord(rawBody);
  const videoId = body.videoId;
  const mime = body.mime;
  const bytes = body.bytes;
  if (!isUuid(videoId) || typeof mime !== "string" || typeof bytes !== "number") return fail(400, "bad_request");
  if (!THUMBNAIL_TYPES[mime] || !Number.isSafeInteger(bytes) || bytes <= 0 || bytes > THUMBNAIL_MAX_BYTES) {
    return fail(400, "thumbnail_invalid");
  }
  const video = await g.db.getVideo(videoId);
  if (!video || video.ownerId !== g.userId || !video.sourceKey || !keyBelongsTo(video.sourceKey, g.userId)) {
    return fail(404, "not_found");
  }
  if (video.status === "uploading") return fail(409, "not_uploading");
  if (video.status === "failed") return fail(409, "not_ready");
  const name = customThumbnailName(mime, crypto.getRandomValues(new Uint8Array(16)));
  if (!name) return fail(400, "thumbnail_invalid");
  try {
    const url = await g.storage.presignThumbnail(thumbnailKey(videoId, name), mime);
    return { status: 200, body: { name, url } };
  } catch {
    return fail(502, "storage_error");
  }
}

/** POST /api/upload/thumbnail { videoId, name }, after the browser PUTs the file. */
export async function finishUploadThumbnail(
  rawBody: unknown,
  ctx: UploadContext,
  origin: string | null,
): Promise<HandlerResult> {
  const g = await gate(ctx);
  if (!g.ok) return g.result;
  const body = asRecord(rawBody);
  const videoId = body.videoId;
  const name = body.name;
  if (!isUuid(videoId) || !isThumbnailName(name) || !name.startsWith("custom-")) {
    return fail(400, "thumbnail_invalid");
  }
  const video = await g.db.getVideo(videoId);
  if (!video || video.ownerId !== g.userId || !video.sourceKey || !keyBelongsTo(video.sourceKey, g.userId)) {
    return fail(404, "not_found");
  }
  if (video.status === "uploading") return fail(409, "not_uploading");
  if (video.status === "failed") return fail(409, "not_ready");

  const key = thumbnailKey(videoId, name);
  let object: { bytes: number; type: string | null } | null;
  try {
    object = await g.storage.thumbnailInfo(key);
  } catch {
    return fail(502, "storage_error");
  }
  if (!object) return fail(422, "upload_failed");
  if (object.bytes <= 0 || object.bytes > THUMBNAIL_MAX_BYTES || !object.type || !THUMBNAIL_TYPES[object.type]) {
    await g.storage.deleteObject(key);
    return fail(400, "thumbnail_invalid");
  }

  const mediaBase = process.env.MEDIA_PUBLIC_URL?.trim().replace(/\/+$/, "");
  const url = mediaBase?.startsWith("https://")
    ? `${mediaBase}/${key}`
    : origin?.startsWith("https://")
      ? `${origin}/api/media/${videoId}/${name}`
      : null;
  const error = await g.db.saveThumbnail(videoId, name, url);
  if (error) {
    await g.storage.deleteObject(key);
    return fail(statusForCode(error), error);
  }
  return { status: 200, body: { videoId, name, url } };
}

/** HTTP status for an error code from the RPCs. */
export function statusForCode(code: string): number {
  switch (code) {
    case "not_signed_in":
      return 401;
    case "upload_off":
    case "not_onboarded":
    case "too_young":
      return 403;
    case "not_found":
      return 404;
    case "no_channel":
    case "not_uploading":
    case "not_ready":
    case "in_trash":
      return 409;
    case "file_too_big":
      return 413;
    case "bad_type":
      return 415;
    case "daily_limit":
      return 429;
    case "suspended":
    case "banned":
      return 403;
    case "title_invalid":
    case "blocked_words":
    case "description_too_long":
    case "bad_visibility":
    case "bad_category":
    case "bad_request":
    case "thumbnail_invalid":
    case "file_empty":
      return 400;
    case "upload_failed":
      return 422;
    default:
      return 500;
  }
}

type Gate = { ok: true; userId: string; storage: UploadStorage; db: UploadDb } | { ok: false; result: HandlerResult };

/** Every route checks the same things in the same order. */
async function gate(ctx: UploadContext): Promise<Gate> {
  if (!ctx.storage) return { ok: false, result: fail(501, "not_configured") };
  if (!ctx.db) return { ok: false, result: fail(503, "no_db") };
  const userId = await ctx.userId();
  if (!userId) return { ok: false, result: fail(401, "not_signed_in") };
  if (!(await ctx.flagOn(userId))) return { ok: false, result: fail(403, "upload_off") };
  return { ok: true, userId, storage: ctx.storage, db: ctx.db };
}

function asRecord(body: unknown): Record<string, unknown> {
  return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
}

/**
 * POST /api/upload/sign  { title, bytes, mime }
 * Makes the video row, starts a multipart upload and presigns each part URL.
 * The browser uploads directly to object storage.
 */
export async function signUpload(rawBody: unknown, ctx: UploadContext): Promise<HandlerResult> {
  const g = await gate(ctx);
  if (!g.ok) return g.result;

  const body = asRecord(rawBody);
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const bytes = typeof body.bytes === "number" ? body.bytes : NaN;
  const mime = typeof body.mime === "string" ? body.mime : "";
  // Same checks as the browser and the database. The type is already decided, so no file name.
  const problem = fileProblemCode({ name: "", type: mime, size: bytes });
  if (problem) return fail(statusForCode(problem), problem);
  if (!title) return fail(400, "title_invalid");

  const created = await g.db.createUpload(title.slice(0, 100), bytes, mime);
  if ("error" in created) return fail(statusForCode(created.error), created.error);
  const { videoId, key } = created;
  if (!keyBelongsTo(key, g.userId)) {
    await g.db.abandonUpload(videoId, "bad key");
    return fail(500, "bad_key");
  }

  let uploadId: string;
  try {
    uploadId = await g.storage.createMultipart(key, mime);
  } catch {
    await g.db.abandonUpload(videoId, "storage error");
    return fail(502, "storage_error");
  }

  const plan = planParts(bytes);
  const urls = await Promise.all(
    plan.map((p) => g.storage.presignPart(key, uploadId, p.partNumber, PART_URL_TTL_S)),
  );
  return {
    status: 200,
    body: {
      videoId,
      key,
      uploadId,
      partSize: PART_SIZE,
      expiresAt: new Date(Date.now() + PART_URL_TTL_S * 1000).toISOString(),
      parts: plan.map((p, i) => ({ partNumber: p.partNumber, url: urls[i] })),
    },
  };
}

/** The parts list from the browser: 1..n in any order, each with an ETag. */
export function readParts(value: unknown, expected: number): CompletedPart[] | null {
  if (!Array.isArray(value) || value.length !== expected) return null;
  const parts: CompletedPart[] = [];
  for (const item of value) {
    const r = asRecord(item);
    const partNumber = r.partNumber;
    const etag = r.etag;
    if (typeof partNumber !== "number" || !Number.isInteger(partNumber)) return null;
    if (typeof etag !== "string" || !etag || etag.length > 200) return null;
    parts.push({ partNumber, etag });
  }
  parts.sort((a, b) => a.partNumber - b.partNumber);
  return parts.every((p, i) => p.partNumber === i + 1) ? parts : null;
}

async function ownUpload(
  g: Extract<Gate, { ok: true }>,
  body: Record<string, unknown>,
): Promise<{ video: VideoRow & { sourceKey: string }; uploadId: string } | HandlerResult> {
  const videoId = body.videoId;
  const uploadId = body.uploadId;
  if (!isUuid(videoId)) return fail(400, "bad_video_id");
  if (typeof uploadId !== "string" || !uploadId || uploadId.length > 1024) return fail(400, "bad_upload_id");
  const video = await g.db.getVideo(videoId);
  // RLS already hides other people's videos; the owner check is a second lock.
  if (!video || video.ownerId !== g.userId || !video.sourceKey) return fail(404, "not_found");
  if (!keyBelongsTo(video.sourceKey, g.userId)) return fail(404, "not_found");
  return { video: { ...video, sourceKey: video.sourceKey }, uploadId };
}

/**
 * POST /api/upload/complete  { videoId, uploadId, parts: [{ partNumber, etag }], title, description, visibility }
 * Joins the parts in object storage, checks the object is there with the right size,
 * saves the form and marks the video uploaded.
 */
export async function completeUpload(rawBody: unknown, ctx: UploadContext): Promise<HandlerResult> {
  const g = await gate(ctx);
  if (!g.ok) return g.result;
  const body = asRecord(rawBody);

  const details: Details | null =
    body.title === undefined
      ? null
      : {
          title: typeof body.title === "string" ? body.title.trim() : "",
          description: typeof body.description === "string" ? body.description : "",
          visibility: "private",
          category: (typeof body.category === "string" ? body.category : "Other") as VideoCategory,
        };
  if (details) {
    const problem = detailsProblem(details);
    if (problem) return { status: 400, body: { error: "bad_details", message: problem } };
  }

  const own = await ownUpload(g, body);
  if ("status" in own) return own;
  const { video, uploadId } = own;

  if (video.status === "uploaded") return done(video.id);
  if (video.status !== "uploading") return fail(409, "not_uploading");

  const parts = readParts(body.parts, planParts(video.sourceBytes ?? 0).length);
  if (!parts) return fail(400, "bad_parts");

  try {
    await g.storage.completeMultipart(video.sourceKey, uploadId, parts);
  } catch {
    return fail(502, "storage_error");
  }

  const size = await g.storage.objectSize(video.sourceKey).catch(() => null);
  if (size === null || size !== video.sourceBytes) {
    await g.db.abandonUpload(video.id, size === null ? "file missing in storage" : "size mismatch");
    return fail(422, "size_mismatch");
  }

  if (details) {
    const err = await g.db.saveDetails(video.id, details);
    if (err) return fail(statusForCode(err), err);
  }
  const err = await g.db.finishUpload(video.id);
  if (err) return fail(statusForCode(err), err);
  return done(video.id);
}

function done(videoId: string): HandlerResult {
  return { status: 200, body: { videoId, status: "uploaded", watchUrl: `/watch?v=${videoId}` } };
}

/**
 * POST /api/upload/abort  { videoId, uploadId }
 * Cancel: throws the uploaded parts away and marks the video failed.
 */
export async function abortUpload(rawBody: unknown, ctx: UploadContext): Promise<HandlerResult> {
  const g = await gate(ctx);
  if (!g.ok) return g.result;
  const own = await ownUpload(g, asRecord(rawBody));
  if ("status" in own) return own;
  const { video, uploadId } = own;
  if (video.status !== "uploading" && video.status !== "failed") return fail(409, "not_uploading");

  // A missing upload id (already aborted or completed) is fine here.
  await g.storage.abortMultipart(video.sourceKey, uploadId).catch(() => undefined);
  const err = await g.db.abandonUpload(video.id, "cancelled");
  if (err && err !== "not_uploading") return fail(statusForCode(err), err);
  return { status: 200, body: { videoId: video.id, status: "failed" } };
}
