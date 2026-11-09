import { redirect } from "next/navigation";
import { Suspense } from "react";
import { ChannelMessage } from "@/components/channel/ChannelNotices";
import { AccountsPage } from "@/components/switch/AccountsPage";
import { accountsState } from "@/lib/switch/server";

export const metadata = { title: "Accounts | PlayPulse" };

async function SwitcherGate() {
  const state = await accountsState();
  switch (state.kind) {
    case "no-db":
      return <ChannelMessage state="no-db" title="database not connected">Connect the database to switch accounts.</ChannelMessage>;
    case "off":
      return <ChannelMessage state="off" title="Switching accounts isn't on yet">Check back soon.</ChannelMessage>;
    case "ready":
      if (!state.signedIn) redirect("/login?next=/account/switcher");
      return <AccountsPage accounts={state.accounts} />;
  }
}

/** /account/switcher, like 2020's account switcher: every account signed in on this browser, and Add account. */
export default function SwitcherPage() {
  return (
    <div className="mx-auto max-w-[1000px] px-4 py-6 sm:px-6">
      <Suspense fallback={null}>
        <SwitcherGate />
      </Suspense>
    </div>
  );
}
