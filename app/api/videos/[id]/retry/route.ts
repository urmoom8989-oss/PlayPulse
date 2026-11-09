import { retryEncode } from "@/lib/processing/server";
import { isUuid, readJson } from "@/lib/studio/http";

const noStore = { "Cache-Control": "no-store" };

function statusFor(code: string): number {
  switch (code) {
    case "not_signed_in":
      return 401;
    case "studio_off":
    case "banned":
    case "suspended":
      return 403;
    case "not_found":
      return 404;
    case "in_trash":
    case "not_failed":
    case "cannot_retry":
      return 409;
    case "rate_limited":
      return 429;
    case "no_db":
      return 503;
    default:
      return 500;
  }
}

// POST /api/videos/<id>/retry with a JSON body ({}): processes the caller's
// failed video again without a new upload, answers { ok: true }. Owner only,
// 3 times a day per video. See retry_encode in 033_retry_failed.sql.
export async function POST(request: Request, ctx: RouteContext<"/api/videos/[id]/retry">) {
  const { id } = await ctx.params;
  // A JSON body keeps plain cross-site forms out.
  if (!isUuid(id) || !(await readJson(request))) return Response.json({ error: "bad_request" }, { status: 400, headers: noStore });
  const result = await retryEncode(id.toLowerCase());
  if ("error" in result) return Response.json(result, { status: statusFor(result.error), headers: noStore });
  return Response.json(result, { headers: noStore });
}
