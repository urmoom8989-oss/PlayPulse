import { broadcastsOn, chatReplay, chatSince, deleteChat, postChat } from "@/lib/live/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const headers = { "Cache-Control": "no-store" };

function statusFor(code: string): number {
  if (code === "not_signed_in") return 401;
  if (code === "chat_off" || code === "chat_closed" || code === "blocked" || code === "broadcasts_off") return 403;
  if (code === "not_found") return 404;
  if (code === "slow_down") return 429;
  if (code === "bad_request" || code === "bad_length" || code === "no_links" || code === "blocked_word") return 400;
  return 503;
}

function fail(code: string) {
  return Response.json({ error: code }, { status: statusFor(code), headers });
}

// Live chat (premieres and live flags).
// GET /api/live/chat?v=<id>&after=<message id> answers { messages } newer than after (the last 50 without it).
// GET /api/live/chat?v=<id>&from=<s>&to=<s> answers the chat replay between two points of the broadcast.
export async function GET(request: Request) {
  if (!(await broadcastsOn())) return fail("broadcasts_off");
  const url = new URL(request.url);
  const v = url.searchParams.get("v") ?? "";
  if (!UUID.test(v)) return fail("bad_request");
  if (url.searchParams.has("from")) {
    const from = Number(url.searchParams.get("from"));
    const to = Number(url.searchParams.get("to"));
    if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return fail("bad_request");
    const result = await chatReplay(v.toLowerCase(), from, to);
    return "error" in result ? fail(result.error) : Response.json({ messages: result }, { headers });
  }
  const after = url.searchParams.get("after");
  const afterId = after === null || after === "" ? null : Number(after);
  if (afterId !== null && (!Number.isInteger(afterId) || afterId < 0)) return fail("bad_request");
  const result = await chatSince(v.toLowerCase(), afterId);
  return "error" in result ? fail(result.error) : Response.json({ messages: result }, { headers });
}

// POST /api/live/chat { videoId, body } answers { id }.
export async function POST(request: Request) {
  const json = (await request.json().catch(() => null)) as { videoId?: unknown; body?: unknown } | null;
  const videoId = typeof json?.videoId === "string" ? json.videoId : "";
  const body = typeof json?.body === "string" ? json.body : "";
  if (!UUID.test(videoId) || !body.trim() || body.length > 400) return fail(body.trim() ? "bad_length" : "bad_request");
  const result = await postChat(videoId.toLowerCase(), body);
  return "error" in result ? fail(result.error) : Response.json(result, { headers });
}

// DELETE /api/live/chat { id }: the author, the channel's owner or an admin.
export async function DELETE(request: Request) {
  const json = (await request.json().catch(() => null)) as { id?: unknown } | null;
  const id = Number(json?.id);
  if (!Number.isInteger(id) || id <= 0) return fail("bad_request");
  const result = await deleteChat(id);
  return "error" in result ? fail(result.error) : Response.json(result, { headers });
}
