// Switch account (031): the parts with no server or database in them.
// No imports, so Node can load this file directly.

/** An account in the switcher. */
export type SwitchAccount = {
  id: string;
  username: string;
  name: string;
  avatarUrl: string | null;
  handle: string | null;
  channelName: string | null;
  subscriberCount: number;
  current: boolean;
  main: boolean;
};

export type MyAccountRow = {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  handle: string | null;
  channel_name: string | null;
  subscriber_count: number | null;
  is_current: boolean;
  is_main: boolean;
};

export function rowToAccount(r: MyAccountRow): SwitchAccount {
  return {
    id: r.id,
    username: r.username,
    name: r.display_name || r.username,
    avatarUrl: r.avatar_url,
    handle: r.handle,
    channelName: r.channel_name,
    subscriberCount: Number(r.subscriber_count) || 0,
    current: r.is_current === true,
    main: r.is_main === true,
  };
}

/** At most this many extra channels per login (link_channel_account in 031). */
export const MAX_CHANNELS = 20;
export const CHANNEL_NAME_MAX = 50;

/** Why a new channel name cannot be used, or null. */
export function channelNameProblem(name: string): string | null {
  const n = name.trim();
  if (!n) return "Give the channel a name.";
  if (n.length > CHANNEL_NAME_MAX) return `Channel names are up to ${CHANNEL_NAME_MAX} characters.`;
  return null;
}

/** The username the new account asks for: the name without spaces, 3 to 24 characters (the database picks another if taken). */
export function usernameFor(name: string): string {
  const base = name.trim().replace(/\s+/g, "").replace(/[^\p{L}\p{N}_.]/gu, "").slice(0, 24);
  return base.length >= 3 ? base : `${base}channel`.slice(0, 24);
}

/** The address an extra channel's account has: never a real mailbox, never shown. */
export function channelAccountEmail(id: string, siteHost: string): string {
  return `channel_${id.toLowerCase().replace(/[^a-z0-9]/g, "")}@users.noreply.${siteHost.toLowerCase()}`;
}

/** Is this one of the addresses channelAccountEmail makes? */
export function isChannelAccountEmail(email: string | null | undefined): boolean {
  return typeof email === "string" && /^channel_[a-z0-9]+@users\.noreply\.[^@\s]+$/i.test(email);
}

/** What the switcher says when something goes wrong. */
export const SWITCH_ERRORS: Record<string, string> = {
  not_signed_in: "Sign in first.",
  switch_off: "Switching accounts isn't on yet.",
  not_configured: "Making channels needs SUPABASE_SERVICE_ROLE_KEY on the server.",
  not_allowed: "You can't switch to that account.",
  too_many_channels: `You can have up to ${MAX_CHANNELS} extra channels.`,
  bad_name: "Give the channel a name of up to 50 characters.",
};

export function switchError(code: string | null | undefined): string {
  return (code && SWITCH_ERRORS[code]) || "Something went wrong. Try again.";
}
