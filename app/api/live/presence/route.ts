import { presencePing } from "@/lib/live/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const headers = { "Cache-Control": "no-store" };

// POST /api/live/presence { videoId }: counts this viewer as watching (or
// waiting) for 30 seconds and answers { viewers }. Signed out viewers are
// counted by the 'sv' cookie, like view pings.
export async function POST(request: Request) {
  const json = (await request.json().catch(() => null)) as { videoId?: unknown } | null;
  const videoId = typeof json?.videoId === "string" ? json.videoId : "";
  if (!UUID.test(videoId)) return Response.json({ error: "bad_request" }, { status: 400, headers });
  const result = await presencePing(videoId.toLowerCase());
  if ("error" in result) return Response.json(result, { status: 503, headers });
  return Response.json(result, { headers });
}
