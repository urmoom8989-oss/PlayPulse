import { setReminder } from "@/lib/live/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const headers = { "Cache-Control": "no-store" };

// POST /api/live/reminder { videoId, on } answers { reminded }. The bell in
// the top bar shows the broadcast once it starts.
export async function POST(request: Request) {
  const json = (await request.json().catch(() => null)) as { videoId?: unknown; on?: unknown } | null;
  const videoId = typeof json?.videoId === "string" ? json.videoId : "";
  if (!UUID.test(videoId) || typeof json?.on !== "boolean") return Response.json({ error: "bad_request" }, { status: 400, headers });
  const result = await setReminder(videoId.toLowerCase(), json.on);
  if ("error" in result) {
    const status = result.error === "not_signed_in" ? 401 : result.error === "not_found" ? 404 : result.error === "rate_limited" ? 429 : 503;
    return Response.json(result, { status, headers });
  }
  return Response.json(result, { headers });
}
