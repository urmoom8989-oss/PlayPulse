"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type SyntheticEvent } from "react";
import { colorFor } from "@/components/Avatar";
import { END_SIZES, elementsDue, type EndElement } from "@/lib/endscreens/rules";
import { useFlag, useSession } from "@/lib/store/session";
import { useSubscriptions } from "@/lib/store/subscriptions";
import { viewToggle } from "@/lib/subscriptions/toggle";
import { formatTime, shortCount } from "@/lib/watch/format";

// The player toggles play on a click, and a double click goes full screen: not on an element.
const stop = (e: SyntheticEvent) => e.stopPropagation();
const guard = { onClick: stop, onDoubleClick: stop };

/** Hover text opens away from the nearer edge of the player. */
const sideOf = (e: EndElement) => (e.x + END_SIZES[e.kind].w / 2 > 0.5 ? "left" : "right");

function Panel({ side, children }: { side: "left" | "right"; children: React.ReactNode }) {
  return (
    <div
      className={`pp-fade-in absolute top-1/2 flex -translate-y-1/2 items-center gap-3 whitespace-nowrap rounded-[2px] bg-black/80 px-3 py-2 text-white ${
        side === "left" ? "right-[calc(100%+8px)]" : "left-[calc(100%+8px)]"
      }`}
    >
      {children}
    </div>
  );
}

type EndVideo = NonNullable<EndElement["video"]>;
type EndChannel = NonNullable<EndElement["channel"]>;

function VideoElement({ v }: { v: EndVideo }) {
  return (
    <Link
      href={`/watch?v=${v.id}`}
      className="group/end absolute inset-0 block overflow-hidden rounded-[2px] bg-black shadow-[0_0_0_1px_rgba(255,255,255,0.25)] transition-shadow hover:shadow-[0_0_0_2px_#fff]"
      aria-label={v.title}
      data-end-video={v.id}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={v.thumbnail} alt="" className="h-full w-full object-cover" draggable={false} />
      {v.durationS !== null && v.durationS > 0 && (
        <span className="absolute bottom-1 right-1 rounded-[2px] bg-black/80 px-1 text-[12px] font-medium leading-[16px] text-white">
          {formatTime(v.durationS)}
        </span>
      )}
      <span className="absolute inset-x-0 top-0 hidden bg-gradient-to-b from-black/85 to-transparent px-2.5 pb-6 pt-2 text-left text-white group-hover/end:block group-focus-visible/end:block">
        <span className="line-clamp-2 text-[14px] font-medium leading-[18px]">{v.title}</span>
        <span className="mt-0.5 block truncate text-[12px] leading-[16px] text-white/80">
          {v.channelName}
          {v.channelName ? " • " : ""}
          {shortCount(v.views)} views
        </span>
      </span>
    </Link>
  );
}

function ChannelElement({ el, c }: { el: EndElement; c: EndChannel }) {
  const [hover, setHover] = useState(false);
  return (
    <Link
      href={`/@${c.handle}`}
      className="absolute inset-0 grid place-items-center outline-none"
      aria-label={c.name}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setHover(true)}
      onBlur={() => setHover(false)}
      data-end-channel={c.handle}
    >
      <span className={`relative block aspect-square h-full overflow-hidden rounded-full bg-black transition-shadow ${hover ? "shadow-[0_0_0_2px_#fff]" : "shadow-[0_0_0_1px_rgba(255,255,255,0.4)]"}`}>
        <RoundPicture name={c.name} url={c.avatarUrl} />
      </span>
      {hover && (
        <Panel side={sideOf(el)}>
          <span className="flex flex-col text-left">
            <span className="max-w-[180px] truncate text-[14px] font-medium">{c.name}</span>
            <span className="text-[12px] text-white/80">{shortCount(c.subscribers)} subscribers</span>
          </span>
        </Panel>
      )}
    </Link>
  );
}

function SubscribeElement({ el, c }: { el: EndElement; c: EndChannel }) {
  const router = useRouter();
  const [hover, setHover] = useState(false);
  const subsOn = useFlag("subscriptions");
  const signedIn = useSession((s) => s.user !== null);
  const status = useSubscriptions((s) => s.status);
  const state = useSubscriptions((s) => s.toggles[c.id]);
  const toggle = useSubscriptions((s) => s.toggle);
  const subscribed = state ? viewToggle(state).subscribed : false;
  const canToggle = subsOn && signedIn && status === "ready" && state !== undefined;

  function click() {
    if (subsOn && !signedIn) {
      const here = window.location.pathname + window.location.search;
      router.push(`/login?next=${encodeURIComponent(here)}`);
      return;
    }
    if (canToggle && !subscribed) {
      toggle(c.id);
      return;
    }
    router.push(`/@${c.handle}`);
  }

  return (
    <div
      className="absolute inset-0 grid place-items-center"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      data-end-subscribe={subscribed ? "yes" : "no"}
    >
      <button
        type="button"
        onClick={click}
        onFocus={() => setHover(true)}
        onBlur={() => setHover(false)}
        aria-label={subscribed ? `Go to ${c.name}` : `Subscribe to ${c.name}`}
        className={`relative block aspect-square h-full overflow-hidden rounded-full bg-black transition-shadow ${
          hover ? "shadow-[0_0_0_2px_#fff]" : "shadow-[0_0_0_1px_rgba(255,255,255,0.4)]"
        }`}
      >
        <RoundPicture name={c.name} url={c.avatarUrl} />
      </button>
      {hover && (
        <Panel side={sideOf(el)}>
          <span className="flex flex-col text-left">
            <span className="max-w-[160px] truncate text-[14px] font-medium">{c.name}</span>
            <span className="text-[12px] text-white/80">{shortCount(c.subscribers)} subscribers</span>
          </span>
          <button
            type="button"
            onClick={click}
            className={`h-8 rounded-[2px] px-3 text-[13px] font-medium uppercase ${subscribed ? "bg-white/20 text-white/80" : "bg-brand text-white"}`}
            data-end-subscribe-button
          >
            {subscribed ? "Subscribed" : "Subscribe"}
          </button>
        </Panel>
      )}
    </div>
  );
}

/** A channel picture that fills a round element of any size. */
function RoundPicture({ name, url }: { name: string; url: string | null }) {
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt="" className="h-full w-full object-cover" draggable={false} />;
  }
  // The default avatar, drawn to fill the circle whatever its size.
  return (
    <svg viewBox="0 0 100 100" className="h-full w-full" aria-hidden>
      <rect width="100" height="100" fill={colorFor(name)} />
      <text x="50" y="52" dominantBaseline="central" textAnchor="middle" fontSize="50" fill="#fff" className="uppercase">
        {name.trim().charAt(0).toUpperCase() || "?"}
      </text>
    </svg>
  );
}

/**
 * End screen elements on the player (045), like 2020: each fades in for the
 * last 5 to 20 seconds the owner picked, where they dragged it. A video opens
 * that video, a channel its page, and Subscribe subscribes (signed out, it
 * goes to sign in first). Gone once the video has ended.
 */
export function EndScreenElements({
  elements,
  time,
  duration,
  hidden,
}: {
  elements: EndElement[];
  time: number;
  duration: number;
  hidden: boolean;
}) {
  if (hidden || elements.length === 0) return null;
  const due = elementsDue(elements, time, duration);
  if (due.length === 0) return null;
  return (
    <div className="pointer-events-none absolute inset-0" data-end-screen={due.length}>
      {due.map((el) => {
        const size = END_SIZES[el.kind];
        return (
          <div
            key={el.id}
            className="pp-tile-in pointer-events-auto absolute"
            style={{ left: `${el.x * 100}%`, top: `${el.y * 100}%`, width: `${size.w * 100}%`, height: `${size.h * 100}%` }}
            data-end-element={el.kind}
            {...guard}
          >
            {el.kind === "video" && el.video ? (
              <VideoElement v={el.video} />
            ) : el.kind === "channel" && el.channel ? (
              <ChannelElement el={el} c={el.channel} />
            ) : el.kind === "subscribe" && el.channel ? (
              <SubscribeElement el={el} c={el.channel} />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
