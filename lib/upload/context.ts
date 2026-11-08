import "server-only";
import { getCurrentUser } from "@/lib/auth";
import { flagOn } from "@/lib/flags";
import { createClient } from "@/lib/supabase/server";
import { createUploadDb } from "./db";
import { readStorageConfig } from "./env";
import type { HandlerResult, UploadContext } from "./handlers";
import { createS3Client, createS3Storage } from "./s3";

/** The real object storage, Supabase and session for the upload routes. */
export async function uploadContext(): Promise<UploadContext> {
  const storage = readStorageConfig();
  const supabase = await createClient();
  return {
    storage: storage ? createS3Storage(createS3Client(storage), storage.bucket) : null,
    db: supabase ? createUploadDb(supabase) : null,
    userId: async () => (await getCurrentUser())?.id ?? null,
    flagOn: (userId) => flagOn("upload", userId),
  };
}

/** Reads the JSON body, runs the handler and answers. Never cached. */
export async function runUploadRoute(
  request: Request,
  handler: (body: unknown, ctx: UploadContext) => Promise<HandlerResult>,
): Promise<Response> {
  const body = await request.json().catch(() => null);
  const result = await handler(body, await uploadContext());
  return Response.json(result.body, { status: result.status, headers: { "Cache-Control": "no-store" } });
}
