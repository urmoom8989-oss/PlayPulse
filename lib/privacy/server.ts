import "server-only";
import { connection } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { flagOn } from "@/lib/flags";
import { readSupabaseConfig } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import type { Privacy } from "./types";

export type { Privacy };

export type PrivacyState = { kind: "off" | "no-db" | "signed-out" | "not-set-up" } | { kind: "ready"; privacy: Privacy };

function notSetUp(code: string | undefined) {
  return code === "PGRST202" || code === "42883";
}

/** Settings > Privacy for the signed in person (the privacy_settings flag). */
export async function myPrivacy(): Promise<PrivacyState> {
  await connection();
  if (!readSupabaseConfig()) return { kind: "no-db" };
  const user = await getCurrentUser();
  if (!(await flagOn("privacy_settings", user?.id ?? null))) return { kind: "off" };
  if (!user) return { kind: "signed-out" };
  const supabase = await createClient();
  if (!supabase) return { kind: "no-db" };
  const { data, error } = await supabase.rpc("my_privacy");
  if (error) return notSetUp(error.code) ? { kind: "not-set-up" } : { kind: "ready", privacy: { subscriptionsPrivate: true, playlistsPrivate: true } };
  const row = (Array.isArray(data) ? data[0] : data) as { subscriptions_private?: boolean; playlists_private?: boolean } | undefined;
  return {
    kind: "ready",
    privacy: { subscriptionsPrivate: row?.subscriptions_private !== false, playlistsPrivate: row?.playlists_private !== false },
  };
}

/** Changes one or both settings. Answers the new settings or an error code. */
export async function savePrivacy(change: Partial<Privacy>): Promise<Privacy | { error: string }> {
  const supabase = await createClient();
  if (!supabase) return { error: "no_db" };
  const { error } = await supabase.rpc("set_privacy", {
    subscriptions_private: change.subscriptionsPrivate ?? null,
    playlists_private: change.playlistsPrivate ?? null,
  });
  if (error) {
    const m = (error.message ?? "").trim();
    return { error: m === "not_signed_in" || m === "privacy_off" ? m : notSetUp(error.code) ? "not_set_up" : "failed" };
  }
  const state = await myPrivacy();
  return state.kind === "ready" ? state.privacy : { error: "failed" };
}

export type PublicSubscription = { id: string; handle: string; name: string; avatarUrl: string | null; subscriberCount: number };

export type ChannelSubscriptionsState =
  | { kind: "unavailable" }
  | { kind: "private" }
  | { kind: "ready"; channels: PublicSubscription[] };

/** The channels a channel's owner subscribes to, when they made that public (the CHANNELS tab). */
export async function channelSubscriptions(channelId: string): Promise<ChannelSubscriptionsState> {
  const supabase = await createClient();
  if (!supabase) return { kind: "unavailable" };
  const { data, error } = await supabase.rpc("channel_subscriptions", { channel_id: channelId, lim: 60 });
  if (error) return { kind: "unavailable" };
  const rows = (Array.isArray(data) ? data : []) as {
    is_private: boolean;
    id: string | null;
    handle: string | null;
    name: string | null;
    avatar_url: string | null;
    subscriber_count: number | null;
  }[];
  if (rows.some((r) => r.is_private)) return { kind: "private" };
  return {
    kind: "ready",
    channels: rows
      .filter((r) => r.id && r.handle)
      .map((r) => ({
        id: r.id as string,
        handle: r.handle as string,
        name: r.name || (r.handle as string),
        avatarUrl: r.avatar_url,
        subscriberCount: Number(r.subscriber_count) || 0,
      })),
  };
}
