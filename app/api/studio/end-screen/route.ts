import { END_MAX, type EndPayload } from "@/lib/endscreens/rules";
import { saveEndScreen } from "@/lib/endscreens/server";
import { badRequest, isUuid, readJson } from "@/lib/studio/http";

const noStore = { "Cache-Control": "no-store" };

function statusFor(code: string): number {
  if (code === "not_signed_in") return 401;
  if (code === "not_owner" || code === "off") return 403;
  if (code === "no_db" || code === "not_set_up") return 503;
  if (code === "failed") return 500;
  return 400;
}

const place = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1;

/** One element from the request, or null when it is not one. The database checks the rest. */
function readElement(v: unknown): EndPayload | null {
  if (!v || typeof v !== "object") return null;
  const r = v as Record<string, unknown>;
  if (!place(r.x) || !place(r.y) || !Number.isInteger(r.show_s)) return null;
  const base = { x: r.x as number, y: r.y as number, show_s: r.show_s as number };
  if (r.kind === "subscribe") return { kind: "subscribe", ...base };
  if (r.kind === "video" && typeof r.video_id === "string") return { kind: "video", video_id: r.video_id.slice(0, 64), ...base };
  if (r.kind === "channel" && typeof r.handle === "string") return { kind: "channel", handle: r.handle.slice(0, 64), ...base };
  return null;
}

// POST /api/studio/end-screen { videoId, elements } replaces the end screen of
// one of the signed in account's videos (045_end_screens.sql) and answers { saved }.
export async function POST(request: Request) {
  const body = await readJson(request);
  if (!body || !isUuid(body.videoId) || !Array.isArray(body.elements) || body.elements.length > END_MAX) return badRequest();
  const elements = body.elements.map(readElement);
  if (elements.some((e) => e === null)) return badRequest();
  const result = await saveEndScreen(body.videoId.toLowerCase(), elements as EndPayload[]);
  if ("error" in result) return Response.json(result, { status: statusFor(result.error), headers: noStore });
  return Response.json(result, { headers: noStore });
}
