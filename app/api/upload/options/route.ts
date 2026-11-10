import { saveUploadOptions } from "@/lib/upload/options";
import { badRequest, isUuid, readJson } from "@/lib/studio/http";

const noStore = { "Cache-Control": "no-store" };
const VISIBILITIES = new Set(["public", "unlisted", "private"]);

function statusFor(code: string): number {
  if (code === "not_signed_in") return 401;
  if (code === "not_found") return 404;
  if (code === "off") return 403;
  if (code === "no_db" || code === "not_set_up") return 503;
  if (code === "failed") return 500;
  return 400;
}

// POST /api/upload/options { videoId, visibility, publishAt, paidPromotion, draft }
// sets who can watch one of your videos, when it goes public, whether it is a
// draft and whether it includes paid promotion (042_upload_options.sql).
export async function POST(request: Request) {
  const b = await readJson(request);
  if (
    !b ||
    !isUuid(b.videoId) ||
    !VISIBILITIES.has(String(b.visibility)) ||
    !(b.publishAt === null || (typeof b.publishAt === "string" && !Number.isNaN(Date.parse(b.publishAt)))) ||
    typeof b.paidPromotion !== "boolean" ||
    typeof b.draft !== "boolean"
  ) {
    return badRequest();
  }
  const result = await saveUploadOptions(b.videoId.toLowerCase(), {
    visibility: b.visibility as "public" | "unlisted" | "private",
    publishAt: b.publishAt === null ? null : new Date(b.publishAt as string).toISOString(),
    paidPromotion: b.paidPromotion,
    draft: b.draft,
  });
  if ("error" in result) return Response.json(result, { status: statusFor(result.error), headers: noStore });
  return Response.json(result, { headers: noStore });
}
