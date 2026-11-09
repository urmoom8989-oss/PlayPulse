"use client";

import { useEffect } from "react";
import type { Lang } from "@/lib/i18n/langs";
import { useSession, type SessionUser } from "@/lib/store/session";
import type { SupabaseConfig } from "@/lib/supabase/env";

/**
 * Hands what the server read for this request (database settings, the signed
 * in person, evaluated feature flags) to the browser store.
 */
export function SessionProvider({
  config,
  user,
  flags,
  lang = "en",
  location = "US",
}: {
  config: SupabaseConfig | null;
  user: SessionUser | null;
  flags: Record<string, boolean>;
  lang?: Lang;
  location?: string;
}) {
  const setSession = useSession((s) => s.setSession);
  useEffect(() => {
    setSession({ config, user, flags, lang, location });
    document.documentElement.lang = lang;
  }, [config, user, flags, lang, location, setSession]);
  return null;
}
