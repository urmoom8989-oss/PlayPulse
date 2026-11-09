"use client";

import { useT } from "@/lib/i18n/client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ReminderIcon } from "@/components/icons";
import { useSession } from "@/lib/store/session";
import { formatCountdown, formatWhen, type Broadcast } from "@/lib/live/state";

/**
 * Where the player will be, before a Premiere or live broadcast starts: the
 * thumbnail, "Premieres in 1:05:09" (or "Live in"), the date, and Set reminder
 * (signed in). At zero the page reloads its data and the player takes over.
 */
export function Countdown({ videoId, broadcast, poster }: { videoId: string; broadcast: Broadcast; poster: string | null }) {
  const t = useT();
  const router = useRouter();
  const signedIn = useSession((s) => s.user !== null);
  const [left, setLeft] = useState<number | null>(null);
  const [reminded, setReminded] = useState(broadcast.reminded);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const at = Date.parse(broadcast.at);
    let lastRefresh = 0;
    const tick = () => {
      const now = Date.now();
      const ms = at - now;
      setLeft(Math.max(0, ms));
      // Ask the server again at zero, and every 5 seconds until it agrees it started.
      if (ms <= 0 && now - lastRefresh > 5000) {
        lastRefresh = now;
        router.refresh();
      }
    };
    const first = setTimeout(tick, 0);
    const t = setInterval(tick, 1000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [broadcast.at, router]);

  async function toggleReminder() {
    if (!signedIn) {
      router.push(`/login?next=${encodeURIComponent(`/watch?v=${videoId}`)}`);
      return;
    }
    setBusy(true);
    const res = await fetch("/api/live/reminder", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ videoId, on: !reminded }),
    }).catch(() => null);
    const json = (await res?.json().catch(() => null)) as { reminded?: boolean } | null;
    setBusy(false);
    if (res?.ok && typeof json?.reminded === "boolean") setReminded(json.reminded);
  }

  const premiere = broadcast.kind === "premiere";
  return (
    <div className="relative grid h-full w-full place-items-center overflow-hidden bg-black text-center text-white" data-countdown>
      {poster && (
        // eslint-disable-next-line @next/next/no-img-element -- the poster comes from the media route, like the player's
        <img src={poster} alt="" className="absolute inset-0 h-full w-full object-cover opacity-40" />
      )}
      <div className="relative px-6">
        <p className="text-[14px] font-medium uppercase tracking-[0.5px] text-[#dddddd]">{premiere ? t("Premieres in") : t("Live in")}</p>
        <p className="mt-1 text-[40px] font-normal leading-[48px] tabular-nums" data-countdown-left>
          {left === null ? "" : left > 0 ? formatCountdown(left) : t("Starting...")}
        </p>
        <p className="mt-1 text-[14px] text-[#dddddd]">{formatWhen(broadcast.at, true)}</p>
        <button
          type="button"
          onClick={() => void toggleReminder()}
          disabled={busy}
          aria-pressed={reminded}
          data-set-reminder={reminded ? "on" : "off"}
          className={`mx-auto mt-5 flex h-9 items-center gap-2 rounded-[2px] px-4 text-[14px] font-medium uppercase tracking-[0.007px] ${
            reminded ? "bg-white/20 text-white" : "bg-white text-[#030303]"
          }`}
        >
          <ReminderIcon className="h-5 w-5" />
          {reminded ? t("Reminder set") : t("Set reminder")}
        </button>
      </div>
    </div>
  );
}
