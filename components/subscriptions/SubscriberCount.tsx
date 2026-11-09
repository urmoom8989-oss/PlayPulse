"use client";

import { formatSubscribers } from "@/lib/channels/validation";
import { useLang } from "@/lib/i18n/client";
import { subscribersIn } from "@/lib/i18n/format";
import { useSubscriptions } from "@/lib/store/subscriptions";
import { viewToggle } from "@/lib/subscriptions/toggle";

/**
 * "1.2K subscribers", live: it follows the Subscribe button for the same
 * channel on this page. Before any click it shows what the server rendered.
 */
export function SubscriberCount({ channelId, count }: { channelId: string; count: number }) {
  const lang = useLang();
  const live = useSubscriptions((s) => {
    const t = s.toggles[channelId];
    return t ? viewToggle(t).count : null;
  });
  const n = live ?? count;
  return <span data-sub-count={n}>{subscribersIn(lang, n, formatSubscribers(n))}</span>;
}
