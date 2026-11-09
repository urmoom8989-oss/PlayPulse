import { myPrivacy, savePrivacy } from "@/lib/privacy/server";

const headers = { "Cache-Control": "no-store" };

function statusFor(code: string): number {
  if (code === "not_signed_in") return 401;
  if (code === "privacy_off") return 403;
  if (code === "bad_request") return 400;
  return 503;
}

// GET /api/settings/privacy answers { subscriptionsPrivate, playlistsPrivate }.
export async function GET() {
  const state = await myPrivacy();
  if (state.kind === "ready") return Response.json(state.privacy, { headers });
  const code = { off: "privacy_off", "no-db": "no_db", "signed-out": "not_signed_in", "not-set-up": "not_set_up" }[state.kind];
  return Response.json({ error: code }, { status: statusFor(code), headers });
}

// POST /api/settings/privacy { subscriptionsPrivate?, playlistsPrivate? } answers the new settings.
export async function POST(request: Request) {
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    return Response.json({ error: "bad_request" }, { status: 400, headers });
  }
  const body = (await request.json().catch(() => null)) as { subscriptionsPrivate?: unknown; playlistsPrivate?: unknown } | null;
  const subs = body?.subscriptionsPrivate;
  const lists = body?.playlistsPrivate;
  if ((subs !== undefined && typeof subs !== "boolean") || (lists !== undefined && typeof lists !== "boolean") || (subs === undefined && lists === undefined)) {
    return Response.json({ error: "bad_request" }, { status: 400, headers });
  }
  const result = await savePrivacy({ subscriptionsPrivate: subs, playlistsPrivate: lists });
  if ("error" in result) return Response.json(result, { status: statusFor(result.error), headers });
  return Response.json(result, { headers });
}
