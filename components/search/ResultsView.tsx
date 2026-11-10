import { EmptyState } from "@/components/EmptyState";
import { SearchIcon } from "@/components/icons";
import Link from "next/link";
import { parseFilters, queryWords, readExact, readQuery, resultsHref, showsVideos, type SearchFilters } from "@/lib/search/query";
import { exactHref, markCorrection } from "@/lib/search/spelling";
import { Tr } from "@/components/i18n/Tr";
import { searchResults } from "@/lib/search/server";
import { ChannelResult } from "./ChannelResult";
import { FilterPanel } from "./FilterPanel";
import { ResultsList } from "./ResultsList";
import { VideoResultSkeleton } from "./VideoResult";

const frame = "mx-auto max-w-[1096px] px-0 py-4 search:px-6";

/** While the first page loads: the FILTER row over skeleton rows. */
export function ResultsSkeleton() {
  return (
    <div className={frame} data-search-state="loading">
      <div className="mb-4 h-9 border-b border-divider" />
      <div className="flex flex-col gap-10 search:gap-4">
        <VideoResultSkeleton />
        <VideoResultSkeleton />
        <VideoResultSkeleton />
      </div>
    </div>
  );
}

function Message({ state, title, hint }: { state: string; title: string; hint: string }) {
  return (
    <div className="px-6 py-20 text-center" data-search-message>
      <SearchIcon className="mx-auto mb-4 h-24 w-24 text-text-3 opacity-60" />
      <h2 className="text-[20px] leading-7 text-text" data-search-message-title={state}>
        <Tr>{title}</Tr>
      </h2>
      <p className="mt-2 text-[14px] text-text-2">
        <Tr>{hint}</Tr>
      </p>
    </div>
  );
}

/** The corrected words in bold italic, the rest plain, like 2020. */
function Corrected({ typed, corrected }: { typed: string; corrected: string }) {
  return (
    <>
      {markCorrection(typed, corrected).map((w, i) => (
        <span key={i}>
          {i > 0 && " "}
          {w.changed ? <b className="font-medium italic">{w.text}</b> : w.text}
        </span>
      ))}
    </>
  );
}

/** "Showing results for" / "Search instead for", or "Did you mean". */
function Spelling({ q, filters, spelling }: { q: string; filters: SearchFilters; spelling: { mode: "showing" | "did-you-mean"; corrected: string } }) {
  if (spelling.mode === "showing") {
    return (
      <div className="px-3 pb-2 pt-1 search:px-0" data-search-spelling="showing">
        <p className="text-[16px] leading-[22px] text-text">
          <Tr>Showing results for</Tr> <Corrected typed={q} corrected={spelling.corrected} />
        </p>
        <p className="text-[14px] leading-5 text-text-2">
          <Tr>Search instead for</Tr>{" "}
          <Link href={exactHref(q, filters)} className="text-link hover:underline" data-search-instead>
            {q}
          </Link>
        </p>
      </div>
    );
  }
  return (
    <p className="px-3 pb-2 pt-1 text-[16px] leading-[22px] text-text search:px-0" data-search-spelling="did-you-mean">
      <Tr>Did you mean:</Tr>{" "}
      <Link href={resultsHref(spelling.corrected, filters)} className="text-link hover:underline" data-search-did-you-mean>
        <Corrected typed={q} corrected={spelling.corrected} />
      </Link>
    </p>
  );
}

/**
 * /results?search_query=<q>. With the search flag off (or no database) a
 * placeholder shows. Reads the request, so it is rendered inside <Suspense>.
 */
export async function ResultsView({
  searchParams,
  heading,
}: {
  searchParams: PageProps<"/results">["searchParams"];
  /** A visible title over the results (the hashtag page), instead of the hidden one. */
  heading?: string;
}) {
  const params = await searchParams;
  const q = readQuery(params);
  const filters = parseFilters(params);
  const state = await searchResults(q, filters, readExact(params));

  switch (state.kind) {
    case "off":
    case "no-db":
      return (
        <div data-search-state={state.kind}>
          <EmptyState title="Search isn't on yet." hint="Search arrives once there are videos to find." cards={4} />
        </div>
      );
    case "not-set-up":
      return (
        <div data-search-state="not-set-up">
          <EmptyState title="Search isn't set up yet." hint="Run supabase/migrations/010_search.sql in the Supabase SQL editor." cards={0} />
        </div>
      );
    case "empty-query":
      return (
        <div className={frame} data-search-state="empty-query">
          <Message state="empty-query" title="Search PlayPulse" hint="Type what you are looking for in the box at the top." />
        </div>
      );
    case "rate-limited":
      return (
        <div className={frame} data-search-state="rate-limited">
          <FilterPanel q={q} filters={filters} />
          <Message state="rate-limited" title="You're searching very fast" hint="Wait a minute, then try again." />
        </div>
      );
    case "failed":
      return (
        <div className={frame} data-search-state="failed">
          <FilterPanel q={q} filters={filters} />
          <Message state="failed" title="Search didn't work this time" hint="Try again in a moment." />
        </div>
      );
    case "ready": {
      const words = queryWords(state.shown);
      const none = state.page.videos.length === 0 && state.channels.length === 0;
      return (
        <div className={frame} data-search-state={none ? "none" : "ready"} data-search-query={q}>
          {heading ? (
            <h1 className="mb-3 px-3 text-[24px] font-normal leading-8 text-text search:px-0" data-results-heading>
              {heading}
            </h1>
          ) : (
            <h1 className="sr-only">Search results for {q}</h1>
          )}
          <div className="px-3 search:px-0">
            <FilterPanel q={q} filters={filters} />
          </div>
          {state.spelling && <Spelling q={q} filters={filters} spelling={state.spelling} />}
          {none ? (
            <Message state="none" title="No results found" hint="Try different keywords or remove search filters" />
          ) : (
            <div className="mt-4">
              {state.channels.length > 0 && (
                <div className={`flex flex-col gap-4 ${showsVideos(filters) ? "mb-4 border-b border-divider pb-4" : ""}`}>
                  {state.channels.map((c) => (
                    <ChannelResult key={c.id} channel={c} words={words} />
                  ))}
                </div>
              )}
              <ResultsList key={`${state.shown}|${JSON.stringify(filters)}`} q={state.shown} filters={filters} words={words} initial={state.page} now={state.now} />
            </div>
          )}
        </div>
      );
    }
  }
}
