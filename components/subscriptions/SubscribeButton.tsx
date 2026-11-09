"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { BellActiveIcon, BellIcon, BellOffIcon, BellOutlineIcon } from "@/components/icons";
import { Menu } from "@/components/Menu";
import { useFlag, useSession } from "@/lib/store/session";
import { useSubscriptions } from "@/lib/store/subscriptions";
import { LEVEL_TEXT, NOTIFY_LEVELS, type NotifyLevel } from "@/lib/subscriptions/rules";
import { viewToggle } from "@/lib/subscriptions/toggle";

const LEVEL_ICON: Record<NotifyLevel, typeof BellIcon> = { all: BellActiveIcon, personalized: BellIcon, none: BellOffIcon };

/** The bell with the 2020 menu: All, Personalized, None (the bell_options flag). */
function BellMenu({ channelId, notify }: { channelId: string; notify: boolean }) {
  const level = useSubscriptions((s) => s.levels[channelId]) ?? (notify ? "all" : "none");
  const setLevel = useSubscriptions((s) => s.setLevel);
  const Icon = LEVEL_ICON[level];
  return (
    <span data-sub-bell={level} className="text-icon">
      <Menu
        label={`Notifications: ${LEVEL_TEXT[level].label}`}
        width={200}
        button={<Icon className="h-6 w-6" />}
      >
        {(close) => (
          <div role="group" aria-label="Notifications">
            {NOTIFY_LEVELS.map((l) => {
              const ItemIcon = LEVEL_ICON[l];
              return (
                <button
                  key={l}
                  type="button"
                  role="menuitemradio"
                  aria-checked={l === level}
                  data-bell-level={l}
                  onClick={() => {
                    close();
                    void setLevel(channelId, l);
                  }}
                  className={`flex h-10 w-full items-center gap-4 px-4 text-left text-[14px] text-text hover:bg-hover ${l === level ? "bg-[var(--active)]" : ""}`}
                >
                  <ItemIcon className="h-6 w-6 shrink-0 text-icon" />
                  {LEVEL_TEXT[l].label}
                </button>
              );
            })}
          </div>
        )}
      </Menu>
    </span>
  );
}

const base =
  "inline-flex h-9 shrink-0 items-center rounded-[2px] px-4 text-[14px] font-medium uppercase tracking-[0.007px]";
const red = `${base} bg-red text-white`;
// SUBSCRIBED is grey on grey in 2019: a light box with grey text, dark in the dark theme.
const grey = `${base} bg-[var(--sub-bg)] text-text-2`;

/** The disabled placeholder, while the flag is off or there is no database. */
function Placeholder({ title }: { title: string }) {
  return (
    <button type="button" disabled title={title} className={`${red} cursor-not-allowed opacity-60`} data-subscribe="off">
      Subscribe
    </button>
  );
}

/**
 * SUBSCRIBE (red) or SUBSCRIBED (grey) with the bell next to it, 2019 style.
 * Clicks show at once and go to the server one at a time (see
 * lib/subscriptions/toggle.ts). Signed out, the click goes to sign in and
 * comes back here. `count` is the subscriber count the server rendered.
 */
export function SubscribeButton({ channelId, channelName, count }: { channelId: string; channelName: string; count: number }) {
  const router = useRouter();
  const on = useFlag("subscriptions");
  const loaded = useSession((s) => s.loaded);
  const signedIn = useSession((s) => s.user !== null);
  const configured = useSession((s) => s.config !== null);
  const status = useSubscriptions((s) => s.status);
  const state = useSubscriptions((s) => s.toggles[channelId]);
  const seed = useSubscriptions((s) => s.seed);
  const toggle = useSubscriptions((s) => s.toggle);
  const bell = useSubscriptions((s) => s.bell);
  const bellOptions = useFlag("bell_options");

  useEffect(() => {
    if (on && signedIn) seed(channelId, count);
  }, [on, signedIn, channelId, count, seed]);

  if (!loaded || !configured || !on) return <Placeholder title="Subscribing isn't on yet." />;

  if (!signedIn) {
    return (
      <button
        type="button"
        className={red}
        data-subscribe="signed-out"
        onClick={() => {
          const here = window.location.pathname + window.location.search;
          router.push(`/login?next=${encodeURIComponent(here)}`);
        }}
      >
        Subscribe
      </button>
    );
  }

  const ready = status === "ready" && state;
  const view = state ? viewToggle(state) : { subscribed: false, notify: false, count };
  if (!ready) {
    return (
      <button type="button" disabled className={`${red} opacity-60`} data-subscribe="loading" aria-busy>
        Subscribe
      </button>
    );
  }

  if (!view.subscribed) {
    return (
      <button
        type="button"
        className={red}
        data-subscribe="no"
        aria-pressed={false}
        onClick={() => toggle(channelId)}
      >
        Subscribe
      </button>
    );
  }

  const Bell = view.notify ? BellActiveIcon : BellOutlineIcon;
  return (
    <span className="inline-flex shrink-0 items-center gap-1">
      <button
        type="button"
        className={grey}
        data-subscribe="yes"
        aria-pressed
        title={`Unsubscribe from ${channelName}`}
        onClick={() => toggle(channelId)}
      >
        Subscribed
      </button>
      {bellOptions ? (
        <BellMenu channelId={channelId} notify={view.notify} />
      ) : (
      <button
        type="button"
        onClick={() => bell(channelId)}
        aria-label={view.notify ? "Turn off notifications" : "Turn on notifications"}
        aria-pressed={view.notify}
        title={view.notify ? "All notifications" : "No notifications"}
        data-sub-bell={view.notify ? "on" : "off"}
        className="grid h-10 w-10 place-items-center rounded-full text-icon hover:bg-hover"
      >
        <Bell className="h-6 w-6" />
      </button>
      )}
    </span>
  );
}
