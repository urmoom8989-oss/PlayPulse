"use client";

import { useState } from "react";
import { Avatar } from "@/components/Avatar";
import { CheckIcon } from "@/components/icons";
import { compactCount } from "@/lib/channels/validation";
import { switchError, type SwitchAccount } from "@/lib/switch/rules";

/** Signs this browser in as another account of the group, then reloads the site as that channel. */
export async function switchAccount(id: string): Promise<string | null> {
  const res = await fetch("/api/accounts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "switch", id }),
  }).catch(() => null);
  const json = (await res?.json().catch(() => null)) as { error?: string } | null;
  if (!res?.ok) return switchError(json?.error);
  window.location.assign("/");
  return null;
}

/** The accounts as 2020 rows: picture, name, handle and subscribers, a check on the current one. */
export function AccountList({ accounts }: { accounts: SwitchAccount[] }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <div data-account-list>
      {accounts.map((a) => (
        <button
          key={a.id}
          type="button"
          role="menuitemradio"
          aria-checked={a.current}
          disabled={a.current || busy !== null}
          data-account={a.handle ?? a.username}
          onClick={async () => {
            setBusy(a.id);
            setError(await switchAccount(a.id));
            setBusy(null);
          }}
          className="flex w-full items-center gap-4 px-4 py-2 text-left hover:bg-hover disabled:hover:bg-transparent"
        >
          <Avatar name={a.name} url={a.avatarUrl} size={40} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[14px] text-text">{a.channelName ?? a.name}</span>
            <span className="block truncate text-[12px] text-text-2">
              {a.handle ? `@${a.handle}` : a.username} · {a.subscriberCount === 0 ? "No subscribers" : `${compactCount(a.subscriberCount)} subscriber${a.subscriberCount === 1 ? "" : "s"}`}
            </span>
          </span>
          {a.current && <CheckIcon className="h-5 w-5 shrink-0 text-icon" />}
          {busy === a.id && <span className="text-[12px] text-text-2">Switching...</span>}
        </button>
      ))}
      {error && (
        <p role="alert" className="px-4 py-2 text-[12px] text-[var(--error)]">
          {error}
        </p>
      )}
    </div>
  );
}
