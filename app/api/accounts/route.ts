import { createChannel, switchState, switchTo } from "@/lib/switch/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const headers = { "Cache-Control": "no-store" };

function statusFor(code: string): number {
  if (code === "not_signed_in") return 401;
  if (code === "switch_off" || code === "not_allowed") return 403;
  if (code === "bad_name" || code === "bad_request") return 400;
  if (code === "too_many_channels") return 409;
  return 503;
}

const fail = (code: string) => Response.json({ error: code }, { status: statusFor(code), headers });

// GET /api/accounts answers { accounts, canCreate } for the switcher (switch_account flag).
export async function GET() {
  const state = await switchState();
  if (state.kind === "ready") return Response.json({ accounts: state.accounts, canCreate: state.canCreate }, { headers });
  return fail(state.kind === "signed-out" ? "not_signed_in" : state.kind === "off" ? "switch_off" : "failed");
}

// POST /api/accounts { action: "switch", id } signs this browser in as that account of the group.
// POST /api/accounts { action: "create", name } makes a new channel and switches to it.
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { action?: unknown; id?: unknown; name?: unknown } | null;
  if (body?.action === "switch") {
    const id = typeof body.id === "string" ? body.id : "";
    if (!UUID.test(id)) return fail("bad_request");
    const result = await switchTo(id.toLowerCase());
    return "error" in result ? fail(result.error) : Response.json(result, { headers });
  }
  if (body?.action === "create") {
    const name = typeof body.name === "string" ? body.name : "";
    const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "localhost";
    const result = await createChannel(name, host.split(":")[0].replace(/[^a-z0-9.-]/gi, "") || "localhost");
    return "error" in result ? fail(result.error) : Response.json(result, { headers });
  }
  return fail("bad_request");
}
