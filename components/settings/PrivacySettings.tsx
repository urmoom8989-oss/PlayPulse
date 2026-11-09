"use client";

import { useT } from "@/lib/i18n/client";
import { useState } from "react";
import type { Privacy } from "@/lib/privacy/types";

const ROWS: { key: keyof Privacy; label: string; hint: string }[] = [
  {
    key: "subscriptionsPrivate",
    label: "Keep all my subscriptions private",
    hint: "Turn this off to show the channels you subscribe to on your channel's CHANNELS tab.",
  },
  {
    key: "playlistsPrivate",
    label: "Keep all my saved playlists private",
    hint: "Playlists you save from other channels stay off your channel. This applies once playlists arrive.",
  },
];

/**
 * Settings > Privacy, 2020 style (the privacy_settings flag): two switches
 * that save as soon as they change, and go back with a message if saving fails.
 */
export function PrivacySettings({ initial }: { initial: Privacy }) {
  const t = useT();
  const [privacy, setPrivacy] = useState(initial);
  const [error, setError] = useState<string | null>(null);

  async function change(key: keyof Privacy, value: boolean) {
    const before = privacy;
    setPrivacy({ ...privacy, [key]: value });
    setError(null);
    const res = await fetch("/api/settings/privacy", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ [key]: value }),
    }).catch(() => null);
    const body = (await res?.json().catch(() => null)) as (Privacy & { error?: string }) | null;
    if (!res?.ok || !body || body.error) {
      setPrivacy(before);
      setError(t("Couldn't save that. Try again."));
      return;
    }
    setPrivacy({ subscriptionsPrivate: body.subscriptionsPrivate, playlistsPrivate: body.playlistsPrivate });
  }

  return (
    <section id="privacy" data-privacy-settings className="mt-8 border-t border-divider pt-6">
      <h2 className="text-[16px] font-medium text-text">{t("Privacy")}</h2>
      <p className="mt-1 text-[14px] text-text-2">{t("Choose who can see what you subscribe to and save.")}</p>
      <div className="mt-4 flex flex-col gap-4">
        {ROWS.map((r) => (
          <label key={r.key} className="flex cursor-pointer items-start gap-4">
            <input
              type="checkbox"
              role="switch"
              checked={privacy[r.key]}
              onChange={(e) => void change(r.key, e.target.checked)}
              data-privacy={r.key}
              className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--link)]"
            />
            <span>
              <span className="block text-[14px] text-text">{t(r.label)}</span>
              <span className="block text-[13px] leading-[18px] text-text-2">{t(r.hint)}</span>
            </span>
          </label>
        ))}
      </div>
      {error && (
        <p role="alert" className="mt-3 text-[13px] text-[var(--error,#cc0000)]">
          {error}
        </p>
      )}
    </section>
  );
}
