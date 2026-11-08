import Image from "next/image";
import Link from "next/link";
import { Suspense } from "react";
import { ChannelMessage, ChannelsNotSetUp } from "@/components/channel/ChannelNotices";
import { ChannelIcon } from "@/components/icons";
import { browseChannels } from "@/lib/channels/server";

export const metadata = { title: "Browse channels | PlayPulse" };

const counts = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });

function pageNumber(value: string | string[] | undefined): number {
  const number = typeof value === "string" ? Number(value) : 1;
  return Number.isSafeInteger(number) && number > 0 ? Math.min(number, 100_000) : 1;
}

type ChannelsPageProps = Pick<PageProps<"/channels">, "searchParams">;

export default function ChannelsPage({ searchParams }: ChannelsPageProps) {
  return (
    <Suspense fallback={<ChannelsSkeleton />}>
      <ChannelsContent searchParams={searchParams} />
    </Suspense>
  );
}

async function ChannelsContent({ searchParams }: ChannelsPageProps) {
  const { page: pageParam } = await searchParams;
  const state = await browseChannels(pageNumber(pageParam));
  if (state.kind === "no-db") {
    return <ChannelMessage state="no-db" title="Database not connected">Connect Supabase to browse real PlayPulse channels.</ChannelMessage>;
  }
  if (state.kind === "off") {
    return <ChannelMessage state="off" title="Channels aren't on yet">Channel browsing is switched off right now. Check back soon.</ChannelMessage>;
  }
  if (state.kind === "not-set-up") return <ChannelsNotSetUp />;
  if (state.kind === "failed") {
    return <ChannelMessage state="failed" title="Channels couldn't be loaded">Please try again in a moment.</ChannelMessage>;
  }

  return (
    <section className="mx-auto max-w-[1284px] px-4 py-8 sm:px-6">
      <header className="mb-6">
        <h1 className="text-[24px] font-normal text-text">Browse channels</h1>
        <p className="mt-1 text-[14px] text-text-2">Discover creators across PlayPulse.</p>
      </header>
      {state.channels.length === 0 ? (
        <p className="rounded-sm border border-divider bg-surface px-5 py-8 text-center text-text-2">
          No channels are available yet.
        </p>
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {state.channels.map((channel) => (
            <li key={channel.id}>
              <Link
                href={`/@${channel.handle}`}
                className="flex min-h-28 items-center gap-4 rounded-sm border border-divider bg-surface p-4 hover:bg-hover"
              >
                {channel.avatarUrl ? (
                  <Image
                    src={channel.avatarUrl}
                    alt=""
                    width={64}
                    height={64}
                    unoptimized
                    className="h-16 w-16 shrink-0 rounded-full object-cover"
                  />
                ) : (
                  <span className="grid h-16 w-16 shrink-0 place-items-center rounded-full bg-hover text-icon">
                    <ChannelIcon className="h-8 w-8" />
                  </span>
                )}
                <span className="min-w-0">
                  <span className="block truncate text-[16px] font-medium text-text">{channel.name}</span>
                  <span className="mt-1 block truncate text-[13px] text-text-2">@{channel.handle}</span>
                  <span className="mt-1 block text-[12px] text-text-3">
                    {counts.format(channel.subscriberCount)} subscribers · {counts.format(channel.videoCount)} videos
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {state.pages > 1 && (
        <nav aria-label="Channel pages" className="mt-8 flex items-center justify-center gap-4">
          {state.page > 1 ? (
            <Link href={`/channels?page=${state.page - 1}`} className="btn-text">Previous</Link>
          ) : (
            <span className="btn-text opacity-50">Previous</span>
          )}
          <span className="text-[13px] text-text-2">Page {state.page} of {state.pages}</span>
          {state.page < state.pages ? (
            <Link href={`/channels?page=${state.page + 1}`} className="btn-text">Next</Link>
          ) : (
            <span className="btn-text opacity-50">Next</span>
          )}
        </nav>
      )}
    </section>
  );
}

function ChannelsSkeleton() {
  return (
    <div aria-hidden className="mx-auto max-w-[1284px] px-4 py-8 sm:px-6">
      <div className="mb-6 h-8 w-52 rounded-sm bg-skeleton" />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 12 }, (_, index) => (
          <div key={index} className="h-28 rounded-sm bg-skeleton" />
        ))}
      </div>
    </div>
  );
}
