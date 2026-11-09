"use client";

import Link from "next/link";
import { useState } from "react";
import type { SwitchAccount } from "@/lib/accounts/saved-rules";
import { AccountList, addAccount, signOutAll } from "./AccountList";

/** /account/switcher: the accounts on this browser, Add account, and a channel for the one in use. */
export function AccountsPage({ accounts }: { accounts: SwitchAccount[] }) {
  const [error, setError] = useState<string | null>(null);
  const current = accounts.find((a) => a.current);
  return (
    <div data-accounts-page>
      <h1 className="text-[24px] font-normal leading-8 text-text">Accounts</h1>
      <p className="mt-1 text-[14px] text-text-2">
        The accounts signed in on this browser. Pick one to switch to it; the others stay signed in.
      </p>
      <div className="mt-6 max-w-[560px] rounded-[2px] bg-surface py-2 shadow-[0_0_0_1px_var(--divider)]">
        <AccountList accounts={accounts} forget />
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" className="btn-blue" onClick={async () => setError(await addAccount())} data-add-account-button>
          Add account
        </button>
        {current && !current.handle && (
          <Link href="/account/create-channel" className="btn-text">
            Create a channel
          </Link>
        )}
        <button type="button" className="btn-text" onClick={() => void signOutAll()}>
          Sign out of all accounts
        </button>
      </div>
      {error && (
        <p role="alert" className="mt-3 text-[13px] text-[var(--error)]">
          {error}
        </p>
      )}
    </div>
  );
}
