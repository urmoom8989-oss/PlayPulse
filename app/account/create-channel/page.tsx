import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AuthCard, DbNotConnected, FeatureOff, FormSkeleton } from "@/components/auth/AuthCard";
import { CreateChannelForm } from "@/components/channel/CreateChannelForm";
import { safeNext } from "@/lib/accounts/redirect";
import { createChannelState } from "@/lib/channels/create";
import { handleProblem, normalizeHandle } from "@/lib/channels/validation";

export const metadata = { title: "Create a channel | PlayPulse" };

async function CreateGate({ searchParams }: { searchParams: PageProps<"/account/create-channel">["searchParams"] }) {
  const params = await searchParams;
  const next = typeof params.next === "string" ? safeNext(params.next) : null;
  const state = await createChannelState();
  switch (state.kind) {
    case "no-db":
      return <DbNotConnected />;
    case "off":
      return <FeatureOff />;
    case "signed-out":
      redirect("/login?next=/account/create-channel");
    case "has-channel":
      redirect(next && next !== "/" ? next : `/@${state.handle}`);
    case "ready": {
      const { user } = state;
      const suggested = normalizeHandle(user.username).replace(/[^a-z0-9_.]/g, "").slice(0, 30);
      return (
        <CreateChannelForm
          defaultName={user.displayName.slice(0, 50)}
          defaultHandle={suggested && !handleProblem(suggested) ? suggested : ""}
          avatarUrl={user.avatarUrl}
          next={next && next !== "/" ? next : null}
        />
      );
    }
  }
}

export default function CreateChannelPage({ searchParams }: PageProps<"/account/create-channel">) {
  return (
    <AuthCard title="Create a channel" subtitle="Upload videos, go live and have a channel page of your own.">
      <Suspense fallback={<FormSkeleton />}>
        <CreateGate searchParams={searchParams} />
      </Suspense>
    </AuthCard>
  );
}
