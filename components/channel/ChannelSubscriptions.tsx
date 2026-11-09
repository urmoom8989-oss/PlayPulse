import Link from "next/link";
import type { ReactNode } from "react";
import type { Channel } from "@/lib/channels/types";
import { formatSubscribers } from "@/lib/channels/validation";
import { channelSubscriptions } from "@/lib/privacy/server";
import { Avatar } from "../Avatar";
import { SubscribeButton } from "../subscriptions/SubscribeButton";

function Empty({ text, hint }: { text: string; hint?: ReactNode }) {
  return (
    <div className="px-6 py-16 text-center" data-channel-subs="empty">
      <p className="text-[16px] leading-[22px] text-text">{text}</p>
      {hint && <p className="mt-1 text-[14px] text-text-2">{hint}</p>}
    </div>
  );
}

/**
 * The CHANNELS tab, 2020 style: the channels this channel's owner subscribes
 * to, as round avatars with their name, subscribers and SUBSCRIBE, when the
 * owner turned off "Keep all my subscriptions private" (privacy_settings).
 */
export async function ChannelSubscriptions({ channel, isOwner }: { channel: Channel; isOwner?: boolean }) {
  const state = await channelSubscriptions(channel.id);
  if (state.kind === "private" || state.kind === "unavailable" || state.channels.length === 0) {
    return (
      <Empty
        text="This channel doesn't feature any other channels."
        hint={
          isOwner && state.kind === "private" ? (
            <>
              Your subscriptions are private. Change that in{" "}
              <Link href="/settings#privacy" className="text-link">
                Settings
              </Link>
              .
            </>
          ) : undefined
        }
      />
    );
  }
  return (
    <section className="mx-auto max-w-[1284px] px-4 py-6 sm:px-6" data-channel-subs="list">
      <h2 className="mb-4 text-[16px] font-normal leading-[22px] text-text">Subscriptions</h2>
      <ul className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
        {state.channels.map((c) => (
          <li key={c.id} className="flex flex-col items-center text-center">
            <Link href={`/@${c.handle}`} className="flex flex-col items-center">
              <Avatar name={c.name} url={c.avatarUrl} size={103} />
              <span className="mt-3 line-clamp-2 text-[14px] font-medium leading-5 text-text">{c.name}</span>
            </Link>
            <span className="mt-1 text-[13px] leading-[18px] text-text-2">{formatSubscribers(c.subscriberCount)}</span>
            <div className="mt-3">
              <SubscribeButton channelId={c.id} channelName={c.name} count={c.subscriberCount} />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
