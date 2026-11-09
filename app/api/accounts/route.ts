import { accountsState, addAccount, forgetAccount, signOutAll, switchTo } from "@/lib/switch/server";
import { readJson } from "@/lib/studio/http";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const headers = { "Cache-Control": "no-store" };

function statusFor(code: string): number {
  if (code === "not_signed_in" || code === "signed_out" || code === "not_saved") return 401;
  if (code === "switch_off" || code === "not_allowed") return 403;
  if (code === "bad_request") return 400;
  return 503;
}

const fail = (code: string) => Response.json({ error: code }, { status: statusFor(code), headers });

// GET /api/accounts answers { accounts, signedIn }: the accounts this browser
// can switch to, the one in use first (switch_account flag).
export async function GET() {
  const state = await accountsState();
  if (state.kind === "ready") return Response.json({ accounts: state.accounts, signedIn: state.signedIn }, { headers });
  return fail(state.kind === "off" ? "switch_off" : "failed");
}

// POST /api/accounts with a JSON body:
//   { action: "switch", id }   use that account here; the one in use waits
//   { action: "add" }          the one in use waits; sign in to another next
//   { action: "forget", id }   drop a waiting account from this browser
//   { action: "signout_all" }  sign out of every account on this browser
export async function POST(request: Request) {
  const body = await readJson(request);
  const state = await accountsState();
  if (state.kind !== "ready") return fail(state.kind === "off" ? "switch_off" : "failed");
  const id = typeof body?.id === "string" && UUID.test(body.id) ? body.id.toLowerCase() : null;
  switch (body?.action) {
    case "switch": {
      if (!id) return fail("bad_request");
      const result = await switchTo(id);
      return "error" in result ? fail(result.error) : Response.json(result, { headers });
    }
    case "add": {
      const result = await addAccount();
      return "error" in result ? fail(result.error) : Response.json(result, { headers });
    }
    case "forget":
      if (!id) return fail("bad_request");
      return Response.json(await forgetAccount(id), { headers });
    case "signout_all": {
      const result = await signOutAll();
      return "error" in result ? fail(result.error) : Response.json(result, { headers });
    }
    default:
      return fail("bad_request");
  }
}
