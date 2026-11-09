import { create } from "zustand";
import type { Lang } from "@/lib/i18n/langs";
import type { SupabaseConfig } from "@/lib/supabase/env";

/** What the browser knows about the signed in person. Never secrets. */
export type SessionUser = {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  /** False until username and birthdate are confirmed (complete_signup). */
  onboarded: boolean;
  /** The person's channel handle, or null before migration 004 is applied. */
  channelHandle: string | null;
};

type SessionState = {
  /** True once the server has handed its values over for this page load. */
  loaded: boolean;
  config: SupabaseConfig | null;
  user: SessionUser | null;
  /** Feature flags already evaluated for this person: key to on or off. */
  flags: Record<string, boolean>;
  /** Language and Location (032): what the site speaks and whose Trending it shows. */
  lang: Lang;
  location: string;
  setSession: (s: {
    config: SupabaseConfig | null;
    user: SessionUser | null;
    flags: Record<string, boolean>;
    lang?: Lang;
    location?: string;
  }) => void;
  /** A new choice in the menu, shown at once. */
  setPrefs: (p: { lang?: Lang; location?: string }) => void;
};

export const useSession = create<SessionState>((set) => ({
  loaded: false,
  config: null,
  user: null,
  flags: {},
  lang: "en",
  location: "US",
  setSession: (s) => set((old) => ({ ...s, lang: s.lang ?? old.lang, location: s.location ?? old.location, loaded: true })),
  setPrefs: (p) => set((old) => ({ lang: p.lang ?? old.lang, location: p.location ?? old.location })),
}));

/** Client side flag check. Use flagOn() from lib/flags.ts on the server. */
export function useFlag(key: string): boolean {
  return useSession((s) => s.flags[key] === true);
}
