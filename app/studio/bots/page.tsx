import { redirect } from "next/navigation";
import { Suspense } from "react";
import { ChannelMessage } from "@/components/channel/ChannelNotices";
import { BotPanel } from "@/components/studio/BotPanel";
import { botPanelState } from "@/lib/bots/server";

export const metadata = { title: "Bots | PlayPulse" };

async function BotsGate() {
  const state = await botPanelState();
  switch (state.kind) {
    case "off":
      return (
        <div data-bot-state="off">
          <ChannelMessage state="off" title="Bots aren't on for this channel">
            The Bots page is for channels that have bots, while the bots flag is on.
          </ChannelMessage>
        </div>
      );
    case "no-db":
      return (
        <div data-bot-state="no-db">
          <ChannelMessage state="no-db" title="database not connected">
            Add the publishable key to <code>.env.local</code> (see <code>.env.example</code>) and restart to use bots.
          </ChannelMessage>
        </div>
      );
    case "signed-out":
      redirect("/login?next=/studio/bots");
    case "not-set-up":
      return (
        <div data-bot-state="not-set-up">
          <ChannelMessage state="not-set-up" title="Bots aren't set up yet">
            Run <code>supabase/migrations/034_bot_panel.sql</code> in the Supabase SQL editor, then reload.
          </ChannelMessage>
        </div>
      );
    case "ready":
      return <BotPanel panel={state.panel} now={state.now} />;
  }
}

export default function StudioBotsPage() {
  return (
    <div className="mx-auto max-w-[1000px] px-4 py-6 sm:px-6">
      <div className="mb-6">
        <h1 className="text-[24px] font-normal leading-8 text-text">Bots</h1>
        <p className="mt-1 text-[14px] text-text-2">
          Add bot views, likes, dislikes, comments and subscribers. Nothing is added unless you order it here.
        </p>
      </div>
      <Suspense fallback={<div className="h-40 rounded-sm bg-skeleton" aria-hidden />}>
        <BotsGate />
      </Suspense>
    </div>
  );
}
