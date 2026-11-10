"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, Suspense, useContext, useEffect, useState, type ComponentType } from "react";
import { mainGuide, railGuide, youGuide, type GuideKey } from "@/lib/guide";
import { useT } from "@/lib/i18n/client";
import { useFlag, useSession } from "@/lib/store/session";
import { useUi } from "@/lib/store/ui";
import { GuideFooterLinks } from "./launch/SiteFooter";
import { GuideButton } from "./GuideButton";
import { GuideSubscriptions } from "./subscriptions/GuideSubscriptions";
import { GuidePlaylists } from "./playlists/GuidePlaylists";
import { SubscriptionsSync } from "./subscriptions/SubscriptionsSync";
import {
  AccountCircleIcon,
  HistoryIcon,
  HomeIcon,
  LibraryIcon,
  SnipsIcon,
  SubscriptionsIcon,
  TrendingIcon,
  SettingsIcon,
  ChannelIcon,
  AddIcon,
} from "./icons";
import { Logo } from "./Logo";

type Item = { href: string; label: string; Icon: ComponentType<{ className?: string }> };
const TOPICS = [
  { label: "Music", icon: "music.jpg" },
  { label: "Sports", icon: "sports.jpg" },
  { label: "Gaming", icon: "gaming.jpg" },
  { label: "Movies and TV", icon: "movies.jpg" },
  { label: "Learning", icon: "learning.jpg" },
  { label: "Fashion", icon: "fashion.jpg" },
  { label: "Live", icon: "live.jpg" },
  { label: "News", icon: "news.jpg" },
];

// Every link the guide can show. Which ones do show comes from lib/guide.ts
// (feature 18): each appears when its feature's flag goes on.
const ITEMS: Record<GuideKey, Item> = {
  home: { href: "/", label: "Home", Icon: HomeIcon },
  shorts: { href: "/shorts", label: "Snips", Icon: SnipsIcon },
  trending: { href: "/trending", label: "Trending", Icon: TrendingIcon },
  subscriptions: { href: "/feed/subscriptions", label: "Subscriptions", Icon: SubscriptionsIcon },
  library: { href: "/library", label: "Library", Icon: LibraryIcon },
  history: { href: "/feed/history", label: "History", Icon: HistoryIcon },
};

function useShellFlags() {
  return {
    feed: useFlag("feed"),
    shorts: useFlag("shorts"),
    subscriptions: useFlag("subscriptions"),
    engagement: useFlag("engagement"),
    playlists: useFlag("playlists"),
  };
}

// The current path, for the active highlight. usePathname() is runtime data on
// dynamic routes (like /@handle), so it is read once inside a <Suspense>
// boundary below and handed down; the fallback renders with no highlight.
const PathContext = createContext<string | null>(null);

function GuideLink({ item, onClick }: { item: Item; onClick?: () => void }) {
  const t = useT();
  const active = useContext(PathContext) === item.href;
  return (
    <Link
      href={item.href}
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={`flex h-10 items-center px-6 text-[14px] ${
        active ? "bg-active font-medium" : "hover:bg-hover"
      }`}
    >
      <item.Icon className={`mr-6 h-6 w-6 shrink-0 ${active ? "text-[var(--mark)]" : "text-icon"}`} />
      <span className="truncate">{t(item.label)}</span>
    </Link>
  );
}

function Section({ children }: { children: React.ReactNode }) {
  return <div className="border-b border-divider py-3">{children}</div>;
}

function SectionTitle({ children }: { children: string }) {
  const t = useT();
  return (
    <h2 className="mb-1 px-6 pt-2 text-[12px] font-medium uppercase leading-4 tracking-[0.3px] text-text-2">
      {t(children)}
    </h2>
  );
}

/** The full 240 px guide content, shared by the docked guide and the drawer. */
function GuideContent({ onNavigate }: { onNavigate?: () => void }) {
  const t = useT();
  const user = useSession((s) => s.user);
  const loaded = useSession((s) => s.loaded);
  const accounts = useFlag("accounts");
  const flags = useShellFlags();
  const channels = useFlag("channels");
  const search = useFlag("search");
  const subscriptions = flags.subscriptions;
  const you = youGuide(flags);
  const main = mainGuide(flags).filter((key) => key !== "shorts");

  return (
    <>
      <Section>
        {main.map((key) => (
          <GuideLink key={key} item={ITEMS[key]} onClick={onNavigate} />
        ))}
      </Section>
      {flags.shorts && (
        <Section>
          <SectionTitle>Explore</SectionTitle>
          <GuideLink item={ITEMS.shorts} onClick={onNavigate} />
        </Section>
      )}
      {(search || channels) && (
        <Section>
          {search && (
            <>
              <SectionTitle>Best of PlayPulse</SectionTitle>
              {TOPICS.map(({ label, icon }) => (
                <Link
                  key={label}
                  href={`/results?search_query=${encodeURIComponent(label)}`}
                  onClick={onNavigate}
                  className="flex h-9 items-center px-6 text-[14px] hover:bg-hover"
                >
                  <Image
                    src={`/topic-icons/${icon}`}
                    alt=""
                    width={24}
                    height={24}
                    className="mr-6 h-6 w-6 shrink-0 rounded-full object-cover"
                  />
                  {t(label)}
                </Link>
              ))}
            </>
          )}
          {channels && (
            <Link
              href="/channels"
              onClick={onNavigate}
              className="flex h-10 items-center px-6 text-[14px] hover:bg-hover"
            >
              <AddIcon className="mr-6 h-6 w-6 shrink-0 text-icon" />
              <span>{t("Browse channels")}</span>
            </Link>
          )}
        </Section>
      )}
      {you.length > 0 && (
        <Section>
          {you.map((key) => (
            <GuideLink key={key} item={ITEMS[key]} onClick={onNavigate} />
          ))}
          {user && flags.playlists && <GuidePlaylists onNavigate={onNavigate} />}
        </Section>
      )}

      {loaded && !user && accounts && (
        <Section>
          <div className="px-8 py-1">
            <p className="text-[14px] leading-5 text-text">
              {t("Sign in to like videos, comment, and subscribe.")}
            </p>
            <Link
              href="/login"
              onClick={onNavigate}
              className="mt-3 inline-flex h-9 items-center gap-2 rounded-[2px] border border-[var(--link)] px-[11px] text-[14px] font-medium uppercase text-[var(--link)]"
            >
              <AccountCircleIcon className="h-6 w-6" />
              {t("Sign in")}
            </Link>
          </div>
        </Section>
      )}

      {user && subscriptions && (
        <Section>
          <SectionTitle>Subscriptions</SectionTitle>
          <GuideSubscriptions onNavigate={onNavigate} />
        </Section>
      )}

      {(channels && user?.channelHandle) || (accounts && user) ? (
        <Section>
          <SectionTitle>More from PlayPulse</SectionTitle>
          {channels && user?.channelHandle && (
            <GuideLink
              item={{ href: `/@${user.channelHandle}`, label: "Your channel", Icon: ChannelIcon }}
              onClick={onNavigate}
            />
          )}
          {accounts && user && (
            <GuideLink item={{ href: "/settings", label: "Settings", Icon: SettingsIcon }} onClick={onNavigate} />
          )}
        </Section>
      ) : null}

      <GuideFooterLinks />
      <p className="px-6 py-4 text-[12px] leading-[18px] text-text-3">
        {t("PlayPulse is built in the open.")}{" "}
        <a href="https://github.com/myfilehero/sloptube" className="hover:underline">
          {t("Source on GitHub")}
        </a>
        . {t("MIT license.")}
      </p>
    </>
  );
}

/** The 72 px icon rail with tiny labels. */
function MiniGuide() {
  const t = useT();
  const pathname = useContext(PathContext);
  const rail = railGuide(useShellFlags()).map((key) => ITEMS[key]);
  return (
    <nav aria-label="Guide" className="sticky top-14 h-[calc(100dvh-56px)] w-[72px] shrink-0 bg-surface">
      {rail.map(({ href, label, Icon }) => {
        const active = pathname === href;
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className="flex flex-col items-center pb-[14px] pt-4 hover:bg-hover"
          >
            <Icon className={`h-6 w-6 ${active ? "text-[var(--mark)]" : "text-icon"}`} />
            <span className="mt-1.5 max-w-full truncate px-1 text-[10px] leading-[14px] text-text">
              {t(label)}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * The left guide, laid out like 2019 YouTube:
 * - from 1313 px: the full 240 px guide, the hamburger folds it into the icon rail
 * - from 792 px: the icon rail, the hamburger opens the full guide as a drawer
 * - below that: only the drawer
 */
export function Guide() {
  return (
    <>
      <SubscriptionsSync />
      <Suspense fallback={<GuideLayout />}>
        <GuideWithPath />
      </Suspense>
    </>
  );
}

function GuideWithPath() {
  const pathname = usePathname();
  return (
    <PathContext.Provider value={pathname}>
      <GuideLayout />
    </PathContext.Provider>
  );
}

function GuideLayout() {
  const guideMini = useUi((s) => s.guideMini);
  const drawerOpen = useUi((s) => s.drawerOpen);
  const close = useUi((s) => s.closeDrawer);
  // The 2019 watch page has no docked guide: the hamburger opens the drawer.
  // Neither has the creator studio, which brings its own left nav.
  const studioNav = useUi((s) => s.studioNav);
  const docked = useContext(PathContext) !== "/watch" && !studioNav;
  // The drawer slides out before it goes: it stays a moment after closing.
  const [wasOpen, setWasOpen] = useState(drawerOpen);
  const [closing, setClosing] = useState(false);
  if (drawerOpen !== wasOpen) {
    setWasOpen(drawerOpen);
    setClosing(!drawerOpen);
  }
  useEffect(() => {
    if (!closing) return;
    const done = setTimeout(() => setClosing(false), 250);
    return () => clearTimeout(done);
  }, [closing]);

  return (
    <>
      <div className={docked ? `hidden tab:block ${guideMini ? "" : "wide:hidden"}` : "hidden"}>
        <MiniGuide />
      </div>

      <nav
        aria-label="Guide"
        className={`sticky top-14 hidden h-[calc(100dvh-56px)] w-60 shrink-0 overflow-y-auto bg-surface ${
          guideMini || !docked ? "" : "wide:block"
        }`}
      >
        <GuideContent />
      </nav>

      {(drawerOpen || closing) && (
        <div className={`fixed inset-0 z-50 ${closing ? "pointer-events-none" : ""}`} data-drawer={closing ? "closing" : "open"}>
          <div onClick={close} aria-hidden className={`absolute inset-0 bg-black/50 ${closing ? "pp-scrim-out" : "pp-scrim-in"}`} />
          <nav
            aria-label="Guide"
            className={`absolute inset-y-0 left-0 w-60 overflow-y-auto bg-surface ${closing ? "pp-drawer-out" : "pp-drawer-in"}`}
            onAnimationEnd={(e) => {
              if (closing && e.target === e.currentTarget) setClosing(false);
            }}
          >
            <div className="flex h-14 items-center pl-4">
              <GuideButton />
              <Logo onClick={close} />
            </div>
            <GuideContent onNavigate={close} />
          </nav>
        </div>
      )}
    </>
  );
}
