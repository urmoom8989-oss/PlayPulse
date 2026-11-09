// Several accounts signed in on one browser, like 2020's "Switch account":
// the other accounts' sessions wait in an httpOnly cookie while one is in use.
// The parts with no server in them. No imports, so Node can load this file.

/** An account signed in on this browser that is not the one in use. rt is its refresh token. */
export type SavedAccount = { id: string; rt: string; email: string | null };

export const SAVED_COOKIE = "pp_accounts";
/** At most this many other accounts wait on one browser. */
export const MAX_SAVED = 10;
/** The cookie lasts about a year; each session inside it lasts as long as Supabase keeps it. */
export const SAVED_MAX_AGE_S = 400 * 24 * 60 * 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The cookie's value as a list; anything that does not look right is dropped. */
export function parseSaved(raw: string | null | undefined): SavedAccount[] {
  if (!raw) return [];
  let data: unknown;
  try {
    data = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];
  const out: SavedAccount[] = [];
  for (const x of data) {
    if (!x || typeof x !== "object") continue;
    const r = x as Record<string, unknown>;
    if (typeof r.id !== "string" || !UUID.test(r.id) || typeof r.rt !== "string" || !r.rt || r.rt.length > 2000) continue;
    if (out.some((s) => s.id === r.id.toLowerCase())) continue;
    out.push({ id: r.id.toLowerCase(), rt: r.rt, email: typeof r.email === "string" && r.email ? r.email.slice(0, 320) : null });
    if (out.length >= MAX_SAVED) break;
  }
  return out;
}

export function serializeSaved(list: SavedAccount[]): string {
  return Buffer.from(JSON.stringify(list.slice(0, MAX_SAVED)), "utf8").toString("base64url");
}

/** The list with this account first (replacing an older entry for it), at most MAX_SAVED. */
export function withSaved(list: SavedAccount[], entry: SavedAccount): SavedAccount[] {
  return [{ ...entry, id: entry.id.toLowerCase() }, ...list.filter((s) => s.id !== entry.id.toLowerCase())].slice(0, MAX_SAVED);
}

export function withoutSaved(list: SavedAccount[], id: string): SavedAccount[] {
  return list.filter((s) => s.id !== id.toLowerCase());
}

/** Supabase's session cookies (sb-<project>-auth-token, in chunks .0, .1 ...). */
export function isAuthCookie(name: string): boolean {
  return /^sb-[a-z0-9-]+-auth-token(\.\d+)?$/i.test(name);
}

/** An account in the switcher. */
export type SwitchAccount = {
  id: string;
  username: string;
  name: string;
  avatarUrl: string | null;
  email: string | null;
  /** The channel, when the account has one (036). */
  handle: string | null;
  channelName: string | null;
  subscriberCount: number;
  current: boolean;
};

/** What the switcher says when something goes wrong. */
const ERRORS: Record<string, string> = {
  not_signed_in: "Sign in first.",
  switch_off: "Switching accounts isn't on yet.",
  not_saved: "That account isn't signed in on this browser any more. Add it again.",
  signed_out: "That account was signed out. Sign in to it again with Add account.",
  not_allowed: "You can't switch to that account.",
  not_configured: "Switching needs SUPABASE_SERVICE_ROLE_KEY on the server.",
};

export function accountError(code: string | null | undefined): string {
  return (code && ERRORS[code]) || "Something went wrong. Try again.";
}
