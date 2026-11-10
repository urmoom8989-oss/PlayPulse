"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { WATERMARK_SIZE, watermarkFileProblem, watermarkFit } from "./watermark-rules";

export const WATERMARK_BUCKET = "watermarks";

/** Fits the picture in a 150 x 150 square with see-through edges, as WebP (PNG if the browser cannot make WebP). */
export async function resizeWatermark(file: File): Promise<Blob> {
  const problem = watermarkFileProblem(file);
  if (problem) throw new Error(problem);
  const bitmap = await createImageBitmap(file);
  const { dx, dy, dw, dh } = watermarkFit(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = WATERMARK_SIZE;
  canvas.height = WATERMARK_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not read the picture.");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, dx, dy, dw, dh);
  bitmap.close();
  const webp = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.9));
  if (webp && webp.type === "image/webp") return webp;
  const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!png) throw new Error("Could not read the picture.");
  return png;
}

/** Uploads to watermarks/<user id>/<time>.<ext>, removes the older ones and returns the public URL. */
export async function uploadWatermark(supabase: SupabaseClient, userId: string, blob: Blob): Promise<string> {
  const ext = blob.type === "image/webp" ? "webp" : "png";
  const path = `${userId}/${Date.now()}.${ext}`;
  const bucket = supabase.storage.from(WATERMARK_BUCKET);
  const { error } = await bucket.upload(path, blob, { contentType: blob.type, cacheControl: "31536000" });
  if (error) throw new Error(error.message);
  await removeWatermarks(supabase, userId, path);
  return bucket.getPublicUrl(path).data.publicUrl;
}

/** Deletes every file in the person's watermark folder, except `keep`. */
export async function removeWatermarks(supabase: SupabaseClient, userId: string, keep?: string) {
  const bucket = supabase.storage.from(WATERMARK_BUCKET);
  const { data } = await bucket.list(userId, { limit: 100 });
  const old = (data ?? []).map((f) => `${userId}/${f.name}`).filter((p) => p !== keep);
  if (old.length) await bucket.remove(old);
}
