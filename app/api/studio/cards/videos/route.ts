import { myCardVideos } from "@/lib/cards/server";

const noStore = { "Cache-Control": "no-store" };

// GET /api/studio/cards/videos: the signed in account's public and unlisted
// videos that are ready, for a video card's list (041).
export async function GET() {
  const result = await myCardVideos();
  if ("error" in result) {
    const status = result.error === "not_signed_in" ? 401 : result.error === "off" ? 403 : result.error === "no_db" ? 503 : 500;
    return Response.json(result, { status, headers: noStore });
  }
  return Response.json(result, { headers: noStore });
}
