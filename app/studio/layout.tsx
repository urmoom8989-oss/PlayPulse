import { Suspense, type ReactNode } from "react";
import { NeedsChannel } from "@/components/channel/NeedsChannel";
import { StudioNav } from "@/components/studio/StudioNav";
import { StudioSkeleton } from "@/components/studio/StudioNotices";
import { getCurrentUser } from "@/lib/auth";
import { botsPanelOn } from "@/lib/bots/server";
import { statsOn } from "@/lib/stats/server";
import { studioOn } from "@/lib/studio/server";

/** The left nav, only while the studio flag is on. Off, every /studio page looks as it did before. */
async function NavGate() {
  if (!(await studioOn())) return null;
  const [user, stats, bots] = await Promise.all([getCurrentUser(), statsOn(), botsPanelOn()]);
  if (user && !user.channelHandle) return null;
  return (
    <StudioNav
      statsOn={stats}
      botsOn={bots}
      channel={{
        name: user?.displayName || user?.username || "Your channel",
        handle: user?.channelHandle ?? null,
        avatarUrl: user?.avatarUrl ?? null,
      }}
    />
  );
}

/** An account without a channel (036) gets "Create a channel first" in place of the studio. */
async function ChannelGate({ children }: { children: ReactNode }) {
  if (await studioOn()) {
    const user = await getCurrentUser();
    if (user && !user.channelHandle) return <NeedsChannel next="/studio" what="use Studio" />;
  }
  return children;
}

export default function StudioLayout({ children }: LayoutProps<"/studio">) {
  return (
    <div className="tab:flex">
      <Suspense fallback={null}>
        <NavGate />
      </Suspense>
      <div className="min-w-0 flex-1">
        <Suspense
          fallback={
            <div className="px-4 py-6 sm:px-8">
              <StudioSkeleton />
            </div>
          }
        >
          <ChannelGate>{children}</ChannelGate>
        </Suspense>
      </div>
    </div>
  );
}
