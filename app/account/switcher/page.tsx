import { redirect } from "next/navigation";
import { Suspense } from "react";
import { ChannelMessage } from "@/components/channel/ChannelNotices";
import { Switcher } from "@/components/switch/Switcher";
import { switchState } from "@/lib/switch/server";

export const metadata = { title: "Your channels | PlayPulse" };

async function SwitcherGate() {
  const state = await switchState();
  switch (state.kind) {
    case "signed-out":
      redirect("/login?next=/account/switcher");
    case "no-db":
      return <ChannelMessage state="no-db" title="database not connected">Connect the database to manage channels.</ChannelMessage>;
    case "not-set-up":
      return <ChannelMessage state="not-set-up" title="Switching accounts isn't set up yet">Run supabase/migrations/031_switch_account.sql.</ChannelMessage>;
    case "off":
      return <ChannelMessage state="off" title="Switching accounts isn't on yet">Check back soon.</ChannelMessage>;
    case "ready":
      return <Switcher accounts={state.accounts} canCreate={state.canCreate} />;
  }
}

/** /account/switcher, like 2020's channel switcher: every channel of this login, and Create a new channel. */
export default function SwitcherPage() {
  return (
    <div className="mx-auto max-w-[1000px] px-4 py-6 sm:px-6">
      <Suspense fallback={null}>
        <SwitcherGate />
      </Suspense>
    </div>
  );
}
