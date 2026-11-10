import { CARDS_MAX, CARD_MESSAGE_MAX, type CardPayload } from "@/lib/cards/rules";
import { saveCards } from "@/lib/cards/server";
import { badRequest, isUuid, readJson } from "@/lib/studio/http";

const noStore = { "Cache-Control": "no-store" };

function statusFor(code: string): number {
  if (code === "not_signed_in") return 401;
  if (code === "not_owner" || code === "off") return 403;
  if (code === "no_db" || code === "not_set_up") return 503;
  if (code === "failed") return 500;
  return 400;
}

/** One card from the request, or null when it is not one. The database checks the rest. */
function readPayload(v: unknown): CardPayload | null {
  if (!v || typeof v !== "object") return null;
  const r = v as Record<string, unknown>;
  const message = typeof r.message === "string" ? r.message.slice(0, CARD_MESSAGE_MAX + 10) : "";
  const start_s = Number.isInteger(r.start_s) ? (r.start_s as number) : 0;
  if (r.kind === "video" && typeof r.video_id === "string") return { kind: "video", video_id: r.video_id.slice(0, 64), message, start_s };
  if (r.kind === "channel" && typeof r.handle === "string") return { kind: "channel", handle: r.handle.slice(0, 64), message, start_s };
  if (r.kind === "link" && typeof r.url === "string") return { kind: "link", url: r.url.slice(0, 2100), message, start_s };
  return null;
}

// POST /api/studio/cards { videoId, cards } replaces the cards on one of the
// signed in account's videos (041_cards.sql) and answers { saved }.
export async function POST(request: Request) {
  const body = await readJson(request);
  if (!body || !isUuid(body.videoId) || !Array.isArray(body.cards) || body.cards.length > CARDS_MAX) return badRequest();
  const cards = body.cards.map(readPayload);
  if (cards.some((c) => c === null)) return badRequest();
  const result = await saveCards(body.videoId.toLowerCase(), cards as CardPayload[]);
  if ("error" in result) return Response.json(result, { status: statusFor(result.error), headers: noStore });
  return Response.json(result, { headers: noStore });
}
