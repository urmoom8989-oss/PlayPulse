"use client";

import { useState } from "react";
import { Avatar } from "@/components/Avatar";
import { CheckIcon, CloseIcon } from "@/components/icons";
import { accountError, type SwitchAccount } from "@/lib/accounts/saved-rules";
import { compactCount } from "@/lib/channels/validation";

async function post(body: Record<string, unknown>): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch("/api/accounts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => null);
  const json = (await res?.json().catch(() => null)) as { error?: string } | null;
  return { ok: Boolean(res?.ok), error: json?.error };
}

/** Uses another account on this browser, then loads `next` as that account. Answers an error text, or null. */
export async function switchAccount(id: string, next = "/"): Promise<string | null> {
  const { ok, error } = await post({ action: "switch", id });
  if (!ok) return accountError(error);
  window.location.assign(next);
  return null;
}

/** "Add account": this account waits, and the sign in page opens for another. */
export async function addAccount(): Promise<string | null> {
  const { ok, error } = await post({ action: "add" });
  if (!ok) return accountError(error);
  window.location.assign("/login?add=1");
  return null;
}

/** "Sign out of all accounts" on this browser. */
export async function signOutAll(): Promise<void> {
  await post({ action: "signout_all" });
  window.location.assign("/");
}

function channelLine(a: SwitchAccount): string {
  if (!a.handle) return "No channel";
  const subs = a.subscriberCount === 0 ? "No subscribers" : `${compactCount(a.subscriberCount)} subscriber${a.subscriberCount === 1 ? "" : "s"}`;
  return `@${a.handle} · ${subs}`;
}

/**
 * The accounts as 2020 rows: picture, name, the address (or @username), the
 * channel when there is one, a check on the one in use. `forget` adds an x to
 * drop a waiting account from this browser (the sign in page).
 */
export function AccountList({ accounts, next = "/", forget = false }: { accounts: SwitchAccount[]; next?: string; forget?: boolean }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [gone, setGone] = useState<string[]>([]);
  return (
    <div data-account-list>
      {accounts
        .filter((a) => !gone.includes(a.id))
        .map((a) => (
          <div key={a.id} className="flex items-center hover:bg-hover">
            <button
              type="button"
              role="menuitemradio"
              aria-checked={a.current}
              disabled={a.current || busy !== null}
              data-account={a.username}
              onClick={async () => {
                setBusy(a.id);
                setError(await switchAccount(a.id, next));
                setBusy(null);
              }}
              className="flex min-w-0 flex-1 items-center gap-4 px-4 py-2 text-left disabled:cursor-default"
            >
              <Avatar name={a.name} url={a.avatarUrl} size={40} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] text-text">{a.name}</span>
                <span className="block truncate text-[12px] text-text-2">{a.email ?? `@${a.username}`}</span>
                <span className="block truncate text-[12px] text-text-2" data-account-channel>
                  {channelLine(a)}
                </span>
              </span>
              {a.current && <CheckIcon className="h-5 w-5 shrink-0 text-icon" />}
              {busy === a.id && <span className="shrink-0 text-[12px] text-text-2">Switching...</span>}
            </button>
            {forget && !a.current && (
              <button
                type="button"
                aria-label={`Remove ${a.name} from this browser`}
                title="Remove from this browser"
                onClick={async () => {
                  await post({ action: "forget", id: a.id });
                  setGone((g) => [...g, a.id]);
                }}
                className="mr-2 grid h-9 w-9 shrink-0 place-items-center rounded-full text-icon hover:bg-[var(--active)]"
                data-account-forget={a.username}
              >
                <CloseIcon className="h-5 w-5" />
              </button>
            )}
          </div>
        ))}
      {error && (
        <p role="alert" className="px-4 py-2 text-[12px] text-[var(--error)]">
          {error}
        </p>
      )}
    </div>
  );
}
