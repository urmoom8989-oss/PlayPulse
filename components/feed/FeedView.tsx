import Link from "next/link";
import { Tr } from "@/components/i18n/Tr";
import { EmptyState } from "@/components/EmptyState";
import { SkeletonRow, videoGridClass } from "@/components/VideoCard";
import { feedState } from "@/lib/feed/server";
import { flagOn } from "@/lib/flags";
import { getPrefs } from "@/lib/i18n/server";
import { locationName } from "@/lib/i18n/langs";
import { tFor } from "@/lib/i18n/t";
import { shelfShorts } from "@/lib/shorts/server";
import type { FeedKind } from "@/lib/feed/types";
import { FeedGrid } from "./FeedGrid";

const frame = "mx-auto max-w-[2200px] px-0 py-6 sm:px-6";

function Header({ title }: { title: string }) {
  return (
    <h1 className="mb-4 px-3 text-[20px] font-normal leading-7 text-text sm:px-0">
      <Tr>{title}</Tr>
    </h1>
  );
}

/** While the first page loads: the header over two rows of skeleton cards. */
export function FeedSkeleton({ title }: { title: string }) {
  return (
    <div className={frame} data-feed-state="loading">
      <Header title={title} />
      <div className={videoGridClass}>
        <SkeletonRow />
        <SkeletonRow />
      </div>
    </div>
  );
}

/**
 * The home grid and /trending. With the feed flag off (or no database) the
 * feature 1 placeholder grid stays. Signed out people see the same feed.
 * Reads the request, so it is rendered inside <Suspense>.
 */
export async function FeedView({
  kind,
  title,
  placeholder,
  home = false,
}: {
  kind: Extract<FeedKind, "newest" | "trending">;
  title: string;
  placeholder: { title?: string; hint?: string };
  home?: boolean;
}) {
  // Language and Location (032): the words in the viewer's language, and
  // Trending for their place ("Trending in Canada").
  const placeOn = await flagOn("language_location");
  const { lang, location } = await getPrefs();
  const t = tFor(lang);
  const country = placeOn ? location : null;
  const state = await feedState(kind, home ? { limit: 8 } : { country });
  const heading = kind === "trending" && country ? t("Trending in {place}", { place: locationName(country, lang) }) : t(title);
  switch (state.kind) {
    case "off":
    case "no-db":
      return (
        <div data-feed-state={state.kind}>
          <EmptyState {...placeholder} />
        </div>
      );
    case "not-set-up":
      return (
        <div data-feed-state="not-set-up">
          <EmptyState
            title="The home feed isn't set up yet."
            hint="Run supabase/migrations/008_feed.sql in the Supabase SQL editor."
          />
        </div>
      );
    case "ready": {
      // The Snips shelf (feature 11), only on the home feed and only with the shorts flag on.
      const shelf = kind === "newest" ? await shelfShorts() : [];
      const trending = home ? await feedState("trending", { country }) : null;
      const trendingCards =
        trending?.kind === "ready"
          ? trending.page.cards.filter((card) => !state.page.cards.some((recommended) => recommended.id === card.id)).slice(0, 8)
          : [];
      if (state.page.cards.length === 0 && shelf.length === 0) {
        return (
          <div data-feed-state="empty">
            <EmptyState
              title={home ? heading : t("Nothing here yet")}
              hint={home ? t("Public videos appear here after they are uploaded and processed.") : t("Public videos show up here once they are processed.")}
              cards={home ? 8 : 4}
            />
          </div>
        );
      }
      return (
        <div className={frame} data-feed-state="ready">
          <Header title={heading} />
          <FeedGrid kind={kind} initial={state.page} now={state.now} ranked={kind === "trending"} shelf={shelf} />
          {trending?.kind === "ready" && trendingCards.length > 0 && (
            <section className="mt-10 border-t border-divider pt-6" aria-labelledby="home-trending-title">
              <div className="mb-4 flex items-center justify-between px-3 sm:px-0">
                <h2 id="home-trending-title" className="text-[20px] font-medium leading-7 text-text">
                  {country ? t("Trending in {place}", { place: locationName(country, lang) }) : t("Trending")}
                </h2>
                <Link href="/trending" className="text-[14px] font-medium text-link hover:underline">
                  {t("See all")}
                </Link>
              </div>
              <FeedGrid
                kind="trending"
                initial={{ cards: trendingCards, next: null }}
                now={trending.now}
              />
            </section>
          )}
        </div>
      );
    }
  }
}
