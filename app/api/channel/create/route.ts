import { createMyChannel } from "@/lib/channels/create";
import { readJson } from "@/lib/studio/http";

const noStore = { "Cache-Control": "no-store" };

function statusFor(code: string): number {
  if (code === "not_signed_in") return 401;
  if (code === "banned") return 403;
  if (code === "has_channel" || code === "handle_taken") return 409;
  if (code === "no_db" || code === "not_set_up") return 503;
  if (code === "failed") return 500;
  return 400;
}

// POST /api/channel/create { name, handle } makes the signed in account's
// channel (036_optional_channels.sql) and answers { handle }. An empty handle
// is made from the username.
export async function POST(request: Request) {
  const body = await readJson(request);
  const name = typeof body?.name === "string" ? body.name.slice(0, 200) : null;
  const handle = typeof body?.handle === "string" ? body.handle.slice(0, 100) : "";
  if (name === null) return Response.json({ error: "bad_request" }, { status: 400, headers: noStore });
  const result = await createMyChannel(name, handle);
  if ("error" in result) return Response.json(result, { status: statusFor(result.error), headers: noStore });
  return Response.json(result, { headers: noStore });
}
