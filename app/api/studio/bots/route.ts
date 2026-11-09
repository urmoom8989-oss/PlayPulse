import { botAction, type BotAction } from "@/lib/bots/server";
import { BOT_KINDS, amountOf, botStatus } from "@/lib/bots/rules";
import { isUuid, readJson } from "@/lib/studio/http";

const noStore = { "Cache-Control": "no-store" };

function read(body: Record<string, unknown>): BotAction | null {
  if (body.action === "order") {
    const videoId = body.videoId === null || body.videoId === undefined ? null : body.videoId;
    if (videoId !== null && !isUuid(videoId)) return null;
    const amounts = Object.fromEntries(BOT_KINDS.map((k) => [k, amountOf(body[k] as number)])) as Record<(typeof BOT_KINDS)[number], number>;
    return { action: "order", videoId: videoId === null ? null : videoId.toLowerCase(), ...amounts, overMinutes: Number(body.overMinutes) };
  }
  if (body.action === "cancel" && isUuid(body.orderId)) return { action: "cancel", orderId: body.orderId.toLowerCase() };
  if (body.action === "live" && isUuid(body.videoId) && typeof body.on === "boolean") {
    return { action: "live", videoId: body.videoId.toLowerCase(), on: body.on };
  }
  return null;
}

// POST /api/studio/bots with a JSON body:
//   { action: "order", videoId | null, views, likes, dislikes, comments, subscribers, overMinutes }
//   { action: "cancel", orderId }
//   { action: "live", videoId, on }
// answers { ok: true }. Only for the owner of a channel with bots_on, with the
// bots flag. See 034_bot_panel.sql.
export async function POST(request: Request) {
  const body = await readJson(request);
  const action = body ? read(body) : null;
  if (!action) return Response.json({ error: "bad_request" }, { status: 400, headers: noStore });
  const result = await botAction(action);
  if ("error" in result) return Response.json(result, { status: botStatus(result.error), headers: noStore });
  return Response.json(result, { headers: noStore });
}
