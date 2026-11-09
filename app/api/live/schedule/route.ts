import { isBroadcastKind } from "@/lib/live/state";
import { cancelBroadcast, ownerBroadcast, scheduleBroadcast } from "@/lib/live/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const headers = { "Cache-Control": "no-store" };

function statusFor(code: string): number {
  if (code === "not_signed_in") return 401;
  if (code === "broadcast_off" || code === "live_not_allowed") return 403;
  if (code === "not_found") return 404;
  if (code === "already_started" || code === "not_ready" || code === "in_trash" || code === "removed") return 409;
  if (code === "bad_request" || code === "bad_time") return 400;
  return 503;
}

// GET /api/live/schedule?v=<id> answers { options, broadcast } for the studio.
export async function GET(request: Request) {
  const v = new URL(request.url).searchParams.get("v") ?? "";
  if (!UUID.test(v)) return Response.json({ error: "bad_request" }, { status: 400, headers });
  const result = await ownerBroadcast(v.toLowerCase());
  if ("error" in result) return Response.json(result, { status: statusFor(result.error), headers });
  return Response.json(result, { headers });
}

// POST /api/live/schedule { videoId, kind: "premiere" | "live", at: ISO or null for now }
// answers { kind, at, visibility }. Owners only; going live needs a channel allowed to.
export async function POST(request: Request) {
  const json = (await request.json().catch(() => null)) as { videoId?: unknown; kind?: unknown; at?: unknown } | null;
  const videoId = typeof json?.videoId === "string" ? json.videoId : "";
  const at = json?.at === null || json?.at === undefined ? null : typeof json.at === "string" && Number.isFinite(Date.parse(json.at)) ? json.at : undefined;
  if (!UUID.test(videoId) || !isBroadcastKind(json?.kind) || at === undefined) {
    return Response.json({ error: "bad_request" }, { status: 400, headers });
  }
  const result = await scheduleBroadcast(videoId.toLowerCase(), json.kind, at);
  if ("error" in result) return Response.json(result, { status: statusFor(result.error), headers });
  return Response.json(result, { headers });
}

// DELETE /api/live/schedule { videoId }: before it starts, back to a plain upload.
export async function DELETE(request: Request) {
  const json = (await request.json().catch(() => null)) as { videoId?: unknown } | null;
  const videoId = typeof json?.videoId === "string" ? json.videoId : "";
  if (!UUID.test(videoId)) return Response.json({ error: "bad_request" }, { status: 400, headers });
  const result = await cancelBroadcast(videoId.toLowerCase());
  if ("error" in result) return Response.json(result, { status: statusFor(result.error), headers });
  return Response.json(result, { headers });
}
