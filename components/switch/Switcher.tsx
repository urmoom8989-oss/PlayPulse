"use client";

import { useState } from "react";
import { Avatar } from "@/components/Avatar";
import { compactCount } from "@/lib/channels/validation";
import { CHANNEL_NAME_MAX, channelNameProblem, switchError, type SwitchAccount } from "@/lib/switch/rules";
import { switchAccount } from "./AccountList";

/**
 * The channel switcher, 2020 style: a card per channel of this login (the
 * current one marked), a click switches to it; and "Create a new channel",
 * which makes one with its own name and switches to it.
 */
export function Switcher({ accounts, canCreate }: { accounts: SwitchAccount[]; canCreate: boolean }) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    const problem = channelNameProblem(name);
    if (problem) return setError(problem);
    setBusy(true);
    setError(null);
    const res = await fetch("/api/accounts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "create", name }),
    }).catch(() => null);
    const json = (await res?.json().catch(() => null)) as { error?: string } | null;
    setBusy(false);
    if (!res?.ok) return setError(switchError(json?.error));
    window.location.assign("/");
  }

  return (
    <section data-switcher>
      <h1 className="text-[24px] font-normal leading-8 text-text">Use PlayPulse as...</h1>
      <p className="mt-1 text-[14px] text-text-2">
        Each channel has its own name, picture, videos, subscriptions and comments. Switch between them any time from the
        account menu.
      </p>
      <ul className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {accounts.map((a) => (
          <li key={a.id}>
            <button
              type="button"
              disabled={a.current || busy}
              data-switch-card={a.handle ?? a.username}
              aria-current={a.current ? "true" : undefined}
              onClick={async () => {
                setBusy(true);
                setError(await switchAccount(a.id));
                setBusy(false);
              }}
              className={`flex h-full w-full flex-col items-center rounded-[2px] border bg-surface px-3 py-6 text-center ${
                a.current ? "border-[var(--link)]" : "border-divider hover:bg-hover"
              }`}
            >
              <Avatar name={a.name} url={a.avatarUrl} size={80} />
              <span className="mt-3 line-clamp-2 text-[14px] font-medium text-text">{a.channelName ?? a.name}</span>
              <span className="mt-1 text-[12px] text-text-2">
                {a.subscriberCount === 0 ? "No subscribers" : `${compactCount(a.subscriberCount)} subscribers`}
              </span>
              {a.current && <span className="mt-2 text-[12px] font-medium uppercase text-link">Current</span>}
            </button>
          </li>
        ))}
        {canCreate && (
          <li>
            {creating ? (
              <form
                className="flex h-full flex-col justify-center rounded-[2px] border border-divider bg-surface px-3 py-6"
                onSubmit={(e) => {
                  e.preventDefault();
                  void create();
                }}
              >
                <label className="text-[13px] text-text-2" htmlFor="new-channel-name">
                  Channel name
                </label>
                <input
                  id="new-channel-name"
                  autoFocus
                  value={name}
                  maxLength={CHANNEL_NAME_MAX}
                  onChange={(e) => setName(e.target.value)}
                  data-new-channel-name
                  className="mt-1 rounded-[2px] border border-[var(--input-border)] bg-[var(--input-bg)] px-2 py-1.5 text-[14px] text-text"
                />
                <div className="mt-3 flex justify-end gap-2">
                  <button type="button" onClick={() => setCreating(false)} className="h-9 px-3 text-[14px] font-medium uppercase text-text-2">
                    Cancel
                  </button>
                  <button type="submit" disabled={busy} data-create-channel className="btn-blue h-9">
                    Create
                  </button>
                </div>
              </form>
            ) : (
              <button
                type="button"
                onClick={() => setCreating(true)}
                data-new-channel
                className="flex h-full w-full flex-col items-center justify-center rounded-[2px] border border-dashed border-divider px-3 py-6 text-[14px] font-medium uppercase text-text-2 hover:bg-hover"
              >
                <span className="mb-2 grid h-20 w-20 place-items-center rounded-full bg-[var(--active)] text-[32px] font-normal">+</span>
                Create a new channel
              </button>
            )}
          </li>
        )}
      </ul>
      {!canCreate && (
        <p className="mt-4 text-[13px] text-text-2">New channels need SUPABASE_SERVICE_ROLE_KEY on the server, or you already have the most.</p>
      )}
      {error && (
        <p role="alert" className="mt-4 text-[13px] text-[var(--error)]">
          {error}
        </p>
      )}
    </section>
  );
}
