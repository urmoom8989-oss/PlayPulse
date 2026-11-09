import "server-only";
import { randomUUID } from "node:crypto";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { getCurrentUser } from "@/lib/auth";
import { flagOn } from "@/lib/flags";
import { readSupabaseConfig } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import { channelAccountEmail, channelNameProblem, MAX_CHANNELS, rowToAccount, usernameFor, type MyAccountRow, type SwitchAccount } from "./rules";

/** The service role client, when SUPABASE_SERVICE_ROLE_KEY is set on the server. */
function adminClient() {
  const config = readSupabaseConfig();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!config || !key) return null;
  return createSupabaseClient(config.url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
}

function codeOf(error: { code?: string; message?: string } | null): string {
  if (!error) return "failed";
  if (error.code === "PGRST202" || error.code === "42883") return "not_set_up";
  return error.code === "P0001" && error.message ? error.message : "failed";
}

export type SwitchState =
  | { kind: "off" | "no-db" | "signed-out" | "not-set-up" }
  | { kind: "ready"; accounts: SwitchAccount[]; canCreate: boolean };

/** The accounts the signed in person can switch between (the switch_account flag). */
export async function switchState(): Promise<SwitchState> {
  const supabase = await createClient();
  if (!supabase) return { kind: "no-db" };
  const user = await getCurrentUser();
  if (!user) return { kind: "signed-out" };
  const { data, error } = await supabase.rpc("my_accounts");
  if (error) return codeOf(error) === "not_set_up" ? { kind: "not-set-up" } : { kind: "off" };
  const accounts = ((Array.isArray(data) ? data : []) as MyAccountRow[]).map(rowToAccount);
  const main = accounts.find((a) => a.main)?.id ?? user.id;
  if (!(await flagOn("switch_account", user.id)) && !(await flagOn("switch_account", main))) return { kind: "off" };
  return { kind: "ready", accounts, canCreate: adminClient() !== null && accounts.length - 1 < MAX_CHANNELS };
}

/**
 * Signs this browser in as `target`, when it is in the same group as the
 * signed in account. The session is made with the service role: a one time
 * magic link token redeemed here at once, never sent anywhere (like Sign in
 * with Yapin'). Route handlers only: it sets the session cookies.
 */
export async function switchTo(target: string): Promise<{ ok: true } | { error: string }> {
  const session = await createClient();
  if (!session) return { error: "no_db" };
  const admin = adminClient();
  if (!admin) return { error: "not_configured" };
  const { data: allowed, error } = await session.rpc("can_switch_to", { target });
  if (error) return { error: codeOf(error) };
  if (allowed !== true) return { error: "not_allowed" };
  const { data: found, error: findError } = await admin.auth.admin.getUserById(target);
  const email = found?.user?.email;
  if (findError || !email) return { error: "failed" };
  const { data: magic, error: linkError } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  const tokenHash = magic?.properties?.hashed_token;
  if (linkError || !tokenHash) return { error: "failed" };
  const { error: otpError } = await session.auth.verifyOtp({ token_hash: tokenHash, type: "magiclink" });
  return otpError ? { error: "failed" } : { ok: true };
}

/** Makes a new channel (an account of its own, in the group) and switches to it. */
export async function createChannel(name: string, siteHost: string): Promise<{ ok: true; id: string } | { error: string }> {
  if (channelNameProblem(name)) return { error: "bad_name" };
  const state = await switchState();
  if (state.kind === "signed-out") return { error: "not_signed_in" };
  if (state.kind !== "ready") return { error: state.kind === "off" ? "switch_off" : "failed" };
  if (!state.canCreate) return { error: state.accounts.length - 1 >= MAX_CHANNELS ? "too_many_channels" : "not_configured" };
  const admin = adminClient();
  const user = await getCurrentUser();
  if (!admin || !user) return { error: "not_configured" };

  const clean = name.trim();
  const { data, error } = await admin.auth.admin.createUser({
    email: channelAccountEmail(randomUUID(), siteHost),
    email_confirm: true,
    user_metadata: { username: usernameFor(clean), full_name: clean },
  });
  if (error || !data.user) return { error: "failed" };
  const { error: linkError } = await admin.rpc("link_channel_account", { owner: user.id, member: data.user.id });
  if (linkError) {
    await admin.auth.admin.deleteUser(data.user.id).catch(() => null);
    return { error: codeOf(linkError) };
  }
  const switched = await switchTo(data.user.id);
  return "error" in switched ? switched : { ok: true, id: data.user.id };
}
