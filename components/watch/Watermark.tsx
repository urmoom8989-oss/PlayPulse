"use client";

import { useRouter } from "next/navigation";
import { useState, type MouseEvent } from "react";
import { useFlag, useSession } from "@/lib/store/session";
import { useSubscriptions } from "@/lib/store/subscriptions";
import { viewToggle } from "@/lib/subscriptions/toggle";
import { watermarkShown, type PlayerWatermark } from "@/lib/channels/watermark-rules";

/**
 * The channel's watermark in the bottom right corner of the player (044),
 * like 2020: see-through until the pointer is on it, then the channel's name
 * and SUBSCRIBE slide out beside it. Clicking subscribes (signed out, it
 * goes to sign in first); once subscribed it opens the channel. Moves up
 * with the controls, like the captions.
 */
export function Watermark({
  watermark,
  time,
  duration,
  raised,
  hidden,
}: {
  watermark: PlayerWatermark;
  time: number;
  duration: number;
  raised: boolean;
  hidden: boolean;
}) {
  const router = useRouter();
  const [hover, setHover] = useState(false);
  const subsOn = useFlag("subscriptions");
  const signedIn = useSession((s) => s.user !== null);
  const status = useSubscriptions((s) => s.status);
  const state = useSubscriptions((s) => s.toggles[watermark.channelId]);
  const toggle = useSubscriptions((s) => s.toggle);

  if (hidden || !watermarkShown(watermark, time, duration)) return null;

  const subscribed = state ? viewToggle(state).subscribed : false;
  const canToggle = subsOn && signedIn && status === "ready" && state !== undefined;

  function click(e: MouseEvent) {
    // The player toggles play on a click; this one is for the watermark.
    e.stopPropagation();
    if (subsOn && !signedIn) {
      const here = window.location.pathname + window.location.search;
      router.push(`/login?next=${encodeURIComponent(here)}`);
      return;
    }
    if (canToggle && !subscribed) {
      toggle(watermark.channelId);
      return;
    }
    router.push(`/@${watermark.channelHandle}`);
  }

  return (
    <div
      className={`absolute right-3 z-20 flex items-center transition-[bottom] duration-200 ${raised ? "bottom-[60px]" : "bottom-3"}`}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      data-watermark={watermark.show}
    >
      {hover && (
        <div className="pp-fade-in mr-2 flex items-center gap-3 rounded-[2px] bg-black/80 py-1.5 pl-3 pr-1.5 text-white">
          <span className="max-w-[160px] truncate text-[13px] font-medium">{watermark.channelName}</span>
          <button
            type="button"
            onClick={click}
            className={`h-7 rounded-[2px] px-2.5 text-[12px] font-medium uppercase ${subscribed ? "bg-white/20 text-white/80" : "bg-brand text-white"}`}
            data-watermark-subscribe={subscribed ? "yes" : "no"}
          >
            {subscribed ? "Subscribed" : "Subscribe"}
          </button>
        </div>
      )}
      <button
        type="button"
        onClick={click}
        aria-label={subscribed ? `Go to ${watermark.channelName}` : `Subscribe to ${watermark.channelName}`}
        title={subscribed ? watermark.channelName : `Subscribe to ${watermark.channelName}`}
        className={`block h-10 w-10 transition-opacity sm:h-12 sm:w-12 ${hover ? "opacity-100" : "opacity-60"}`}
        data-watermark-button
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={watermark.url} alt="" className="h-full w-full object-contain" draggable={false} />
      </button>
    </div>
  );
}
