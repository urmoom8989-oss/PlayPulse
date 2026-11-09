import "server-only";
import { cookies } from "next/headers";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { getCurrentUser } from "@/lib/auth";
import { flagOn } from "@/lib/flags";
import {
  SAVED_COOKIE,
  SAVED_MAX_AGE_S,
  isAuthCookie,
  parseSaved,
  serializeSaved,
  withSaved,
  withoutSaved,
  type SavedAccount,
  type SwitchAccount,
} from "@/lib/accounts/saved-rules";
import { readSupabaseConfig } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import { isPlaceholderEmail } from "@/lib/yapin/rules";
import { isChannelAccountEmail } from "./rules";

// Switch account, 2020 style: several accounts signed in on one browser. The
// account in use has Supabase's session cookies; the others wait in the
// httpOnly pp_accounts cookie with their refresh tokens (lib/accounts/
// saved-rules.ts). Switching swaps them. Accounts linked to this one by 031
// (channels made by the old "Add channel") are listed too and switched to with
// the service role, as before.

/** The service role client, when SUPABASE_SERVICE_ROLE_KEY is set on the server. */
function adminClient() {
  const config = readSupabaseConfig();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!config || !key) return null;
  return createSupabaseClient(config.url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
}

const shownEmail = (email: unknown) =>
  typeof email === "string" && !isPlaceholderEmail(email) && !isChannelAccountEmail(email) ? email : null;

async function readSaved(): Promise<SavedAccount[]> {
  return parseSaved((await cookies()).get(SAVED_COOKIE)?.value);
}

/** Route handlers only: writes the waiting accounts. */
async function writeSaved(list: SavedAccount[]) {
  const store = await cookies();
  if (list.length === 0) {
    store.delete(SAVED_COOKIE);
    return;
  }
  store.set(SAVED_COOKIE, serializeSaved(list), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SAVED_MAX_AGE_S,
  });
}

/** Route handlers only: forgets this browser's session without ending it, so it can be used again later. */
async function dropSessionCookies() {
  const store = await cookies();
  for (const c of store.getAll()) if (isAuthCookie(c.name)) store.delete(c.name);
}

/** The account in use, with its refresh token, so it can wait while another is used. */
async function currentForSaving(supabase: NonNullable<Awaited<ReturnType<typeof createClient>>>): Promise<SavedAccount | null> {
  const { data: claims } = await supabase.auth.getClaims();
  const id = claims?.claims?.sub;
  if (!id) return null;
  // getSession refreshes an expired session first, so the token kept is the newest.
  const { data } = await supabase.auth.getSession();
  const rt = data.session?.refresh_token;
  return rt ? { id, rt, email: shownEmail(claims.claims.email) } : null;
}

export type AccountsState =
  | { kind: "off" | "no-db" }
  | { kind: "ready"; accounts: SwitchAccount[]; signedIn: boolean };

/** Every account this browser can switch to, the one in use first (the switch_account flag). */
export async function accountsState(): Promise<AccountsState> {
  const supabase = await createClient();
  if (!supabase) return { kind: "no-db" };
  const user = await getCurrentUser();
  if (!(await flagOn("switch_account", user?.id ?? null))) return { kind: "off" };
  const saved = await readSaved();

  // Accounts linked by 031 (the old "Add channel"): still accounts you can switch to.
  const linked: string[] = [];
  if (user) {
    const { data } = await supabase.rpc("my_accounts");
    for (const r of (Array.isArray(data) ? data : []) as { id: string }[]) if (r.id !== user.id) linked.push(r.id);
  }
  const ids = [...new Set([...(user ? [user.id] : []), ...saved.map((s) => s.id), ...linked])];
  if (ids.length === 0) return { kind: "ready", accounts: [], signedIn: false };

  const [{ data: profiles }, { data: channels }] = await Promise.all([
    supabase.from("profiles").select("id, username, display_name, avatar_url").in("id", ids),
    supabase.from("channels").select("owner_id, handle, name, subscriber_count").in("owner_id", ids),
  ]);
  const byProfile = new Map(((profiles ?? []) as { id: string; username: string; display_name: string | null; avatar_url: string | null }[]).map((p) => [p.id, p]));
  const byChannel = new Map(((channels ?? []) as { owner_id: string; handle: string; name: string; subscriber_count: number }[]).map((c) => [c.owner_id, c]));
  const accounts: SwitchAccount[] = [];
  for (const id of ids) {
    const p = byProfile.get(id);
    if (!p) continue;
    const c = byChannel.get(id);
    accounts.push({
      id,
      username: p.username,
      name: p.display_name || p.username,
      avatarUrl: p.avatar_url,
      email: id === user?.id ? user.email : (saved.find((s) => s.id === id)?.email ?? null),
      handle: c?.handle ?? null,
      channelName: c ? c.name || c.handle : null,
      subscriberCount: Number(c?.subscriber_count) || 0,
      current: id === user?.id,
    });
  }
  return { kind: "ready", accounts, signedIn: Boolean(user) };
}

/**
 * Uses another account on this browser: one waiting in pp_accounts, or one
 * linked by 031. The account in use waits in its place. Route handlers only.
 */
export async function switchTo(target: string): Promise<{ ok: true } | { error: string }> {
  const supabase = await createClient();
  if (!supabase) return { error: "no_db" };
  const saved = await readSaved();
  const current = await currentForSaving(supabase);
  if (current?.id === target) return { ok: true };
  const waiting = saved.find((s) => s.id === target);

  if (waiting) {
    // The other session becomes this browser's; its refresh token is used up.
    const { data, error } = await supabase.auth.refreshSession({ refresh_token: waiting.rt });
    if (error || !data.session) {
      await writeSaved(withoutSaved(saved, target));
      return { error: "signed_out" };
    }
    await writeSaved(current ? withSaved(withoutSaved(saved, target), current) : withoutSaved(saved, target));
    return { ok: true };
  }

  // An account linked by 031: signed in with the service role (a one time
  // magic link token redeemed here at once), when the database allows it.
  if (!current) return { error: "not_saved" };
  const admin = adminClient();
  if (!admin) return { error: "not_configured" };
  const { data: allowed, error } = await supabase.rpc("can_switch_to", { target });
  if (error || allowed !== true) return { error: "not_allowed" };
  const { data: found } = await admin.auth.admin.getUserById(target);
  const email = found?.user?.email;
  if (!email) return { error: "failed" };
  const { data: magic, error: linkError } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  const tokenHash = magic?.properties?.hashed_token;
  if (linkError || !tokenHash) return { error: "failed" };
  const { error: otpError } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: "magiclink" });
  if (otpError) return { error: "failed" };
  await writeSaved(withSaved(saved, current));
  return { ok: true };
}

/**
 * "Add account": the account in use waits in pp_accounts and this browser is
 * signed out of it without ending its session, ready to sign in to another.
 */
export async function addAccount(): Promise<{ ok: true } | { error: string }> {
  const supabase = await createClient();
  if (!supabase) return { error: "no_db" };
  const current = await currentForSaving(supabase);
  if (current) await writeSaved(withSaved(await readSaved(), current));
  await dropSessionCookies();
  return { ok: true };
}

/** "Sign out of all accounts": ends the session in use and forgets the waiting ones. */
export async function signOutAll(): Promise<{ ok: true } | { error: string }> {
  const supabase = await createClient();
  if (!supabase) return { error: "no_db" };
  await supabase.auth.signOut({ scope: "local" }).catch(() => null);
  await dropSessionCookies();
  await writeSaved([]);
  return { ok: true };
}

/** Forgets one waiting account on this browser (the x next to it on the sign in page). */
export async function forgetAccount(id: string): Promise<{ ok: true }> {
  await writeSaved(withoutSaved(await readSaved(), id));
  return { ok: true };
}
