"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useFlag, type SessionUser } from "@/lib/store/session";
import { createClient } from "@/lib/supabase/client";
import type { SwitchAccount } from "@/lib/accounts/saved-rules";
import { Avatar } from "./Avatar";
import { AddIcon, ArrowBackIcon, ChannelIcon, ChevronRightIcon, SettingsIcon, SignOutIcon, SwitchAccountIcon } from "./icons";
import { Menu, MenuDivider, MenuItem } from "./Menu";
import { PrefsMenuItems, PrefsPanel } from "./i18n/PrefsMenu";
import { AccountList, addAccount, signOutAll } from "./switch/AccountList";
import { useT } from "@/lib/i18n/client";
import { ThemeMenuItem } from "./ThemeMenuItem";

/**
 * The avatar in the top bar and its menu, 2019 style. With switch_account,
 * "Switch account" opens the accounts signed in on this browser and Add
 * account. Without a channel (036), "Create a channel" takes the place of
 * "Your channel".
 */
export function AvatarMenu({ user, email }: { user: SessionUser; email: string | null }) {
  const router = useRouter();
  const channels = useFlag("channels");
  const switching = useFlag("switch_account");
  const t = useT();
  const [view, setView] = useState<"main" | "accounts" | "language" | "location">("main");
  const [accounts, setAccounts] = useState<SwitchAccount[] | null>(null);
  const [accountsError, setAccountsError] = useState<string | null>(null);

  async function signOut() {
    await createClient()?.auth.signOut();
    router.push("/");
    router.refresh();
  }

  async function openAccounts() {
    setView("accounts");
    const res = await fetch("/api/accounts", { cache: "no-store" }).catch(() => null);
    const json = (await res?.json().catch(() => null)) as { accounts?: SwitchAccount[] } | null;
    setAccounts(json?.accounts ?? []);
  }

  return (
    <Menu
      label={t("Account menu")}
      button={<Avatar name={user.displayName} url={user.avatarUrl} size={32} />}
      onOpen={() => setView("main")}
    >
      {(close) =>
        view === "language" || view === "location" ? (
          <PrefsPanel view={view} onBack={() => setView("main")} onDone={close} />
        ) : view === "accounts" ? (
          <div data-switch-panel>
            <button
              type="button"
              onClick={() => setView("main")}
              className="flex h-12 w-full items-center gap-4 border-b border-divider px-4 text-left text-[16px] text-text"
            >
              <ArrowBackIcon className="h-6 w-6 text-icon" />
              {t("Accounts")}
            </button>
            {accounts === null ? (
              <p className="px-4 py-3 text-[13px] text-text-2">{t("Loading...")}</p>
            ) : (
              <div className="pt-1">
                <AccountList accounts={accounts} />
              </div>
            )}
            <MenuDivider />
            <MenuItem icon={<AddIcon className="h-6 w-6" />} onClick={async () => setAccountsError(await addAccount())}>
              {t("Add account")}
            </MenuItem>
            <MenuItem icon={<SignOutIcon className="h-6 w-6" />} onClick={() => void signOutAll()}>
              {t("Sign out of all accounts")}
            </MenuItem>
            {accountsError && (
              <p role="alert" className="px-4 pb-2 text-[12px] text-[var(--error)]">
                {accountsError}
              </p>
            )}
          </div>
        ) : (
          <>
            <div className="flex gap-4 px-4 pb-4 pt-2">
              <Avatar name={user.displayName} url={user.avatarUrl} size={40} />
              <div className="min-w-0">
                <p className="truncate text-[16px] font-medium leading-[22px] text-text">{user.displayName}</p>
                <p className="truncate text-[14px] leading-5 text-text-2">@{user.username}</p>
                {email && <p className="truncate text-[14px] leading-5 text-text-2">{email}</p>}
                <Link href="/settings" onClick={close} className="mt-2 inline-block text-[14px] text-[var(--link)]">
                  {t("Manage your account")}
                </Link>
              </div>
            </div>
            <MenuDivider />
            {channels && user.channelHandle && (
              <MenuItem
                icon={<ChannelIcon className="h-6 w-6" />}
                onClick={() => {
                  close();
                  router.push(`/@${user.channelHandle}`);
                }}
              >
                {t("Your channel")}
              </MenuItem>
            )}
            {channels && !user.channelHandle && (
              <MenuItem
                icon={<ChannelIcon className="h-6 w-6" />}
                onClick={() => {
                  close();
                  router.push("/account/create-channel");
                }}
              >
                {t("Create a channel")}
              </MenuItem>
            )}
            {switching && (
              <MenuItem
                icon={<SwitchAccountIcon className="h-6 w-6" />}
                onClick={() => void openAccounts()}
                trailing={<ChevronRightIcon className="h-6 w-6 text-icon" />}
              >
                {t("Switch account")}
              </MenuItem>
            )}
            <MenuItem
              icon={<SettingsIcon className="h-6 w-6" />}
              onClick={() => {
                close();
                router.push("/settings");
              }}
            >
              {t("Settings")}
            </MenuItem>
            <ThemeMenuItem />
            <PrefsMenuItems onOpen={setView} />
            <MenuItem
              icon={<SignOutIcon className="h-6 w-6" />}
              onClick={() => {
                close();
                void signOut();
              }}
            >
              {t("Sign out")}
            </MenuItem>
          </>
        )
      }
    </Menu>
  );
}
