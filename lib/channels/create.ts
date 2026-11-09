import "server-only";
import { connection } from "next/server";
import { getCurrentUser, type CurrentUser } from "@/lib/auth";
import { flagOn } from "@/lib/flags";
import { readSupabaseConfig } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";

// "Create a channel" (036_optional_channels.sql): an account makes its own
// channel when it wants one.

export type CreateChannelState =
  | { kind: "off" | "no-db" | "signed-out" }
  | { kind: "has-channel"; handle: string }
  | { kind: "ready"; user: CurrentUser };

/** What /account/create-channel shows. Reads the request: call it inside <Suspense>. */
export async function createChannelState(): Promise<CreateChannelState> {
  await connection();
  if (!readSupabaseConfig()) return { kind: "no-db" };
  const user = await getCurrentUser();
  if (!user) return { kind: "signed-out" };
  if (!(await flagOn("channels", user.id))) return { kind: "off" };
  if (user.channelHandle) return { kind: "has-channel", handle: user.channelHandle };
  return { kind: "ready", user };
}

const CODES = ["not_signed_in", "banned", "has_channel", "bad_name", "handle_invalid", "handle_reserved", "handle_taken"];

/** Makes the caller's channel (create_my_channel). Answers its handle. */
export async function createMyChannel(name: string, handle: string): Promise<{ handle: string } | { error: string }> {
  const supabase = await createClient();
  if (!supabase) return { error: "no_db" };
  if (!(await getCurrentUser())) return { error: "not_signed_in" };
  const { data, error } = await supabase.rpc("create_my_channel", { name, handle: handle || null });
  if (error) {
    if (error.code === "PGRST202" || error.code === "42883") return { error: "not_set_up" };
    const code = String(error.message ?? "").trim();
    return { error: CODES.includes(code) ? code : "failed" };
  }
  return { handle: String(data) };
}
