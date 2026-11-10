import { Suspense } from "react";
import Link from "next/link";
import { EmptyState } from "@/components/EmptyState";
import { HistoryIcon, PlaylistPlayIcon } from "@/components/icons";
import { PlaylistCard } from "@/components/playlists/PlaylistCard";
import { myPlaylists } from "@/lib/playlists/server";

export const metadata = { title: "Library | PlayPulse" };

function Empty() {
  return (
    <EmptyState
      title="Your library is empty."
      hint="Videos you watch show up in History, and the channels you follow in Subscriptions."
      cards={0}
    />
  );
}

/**
 * The 2020 library: Watch later and your playlists (043) as cards, with a
 * link to History. Signed out, or before playlists, the short note.
 */
async function Library() {
  const mine = await myPlaylists();
  if ("error" in mine) {
    if (mine.error === "not_signed_in") {
      return (
        <div data-library-state="signed-out">
          <EmptyState title="Enjoy your favorite videos" hint="Sign in to see videos you've saved and your playlists." cards={0} />
          <div className="-mt-4 px-4 sm:px-6">
            <Link href="/login?next=%2Flibrary" className="btn-blue uppercase">
              Sign in
            </Link>
          </div>
        </div>
      );
    }
    return (
      <div data-library-state={mine.error}>
        <Empty />
      </div>
    );
  }
  return (
    <div className="mx-auto max-w-[1284px] px-4 py-6 sm:px-6" data-library-state="ready">
      <section>
        <div className="mb-4 flex items-center gap-4 border-b border-divider pb-3">
          <PlaylistPlayIcon className="h-6 w-6 text-icon" />
          <h1 className="text-[16px] font-medium text-text">Playlists</h1>
          <span className="text-[14px] text-text-2">{mine.playlists.length}</span>
          <Link href="/feed/history" className="ml-auto flex items-center gap-2 text-[14px] font-medium uppercase text-[var(--link)]">
            <HistoryIcon className="h-5 w-5" /> History
          </Link>
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-8 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5" data-library-playlists>
          {mine.playlists.map((l) => (
            <PlaylistCard key={l.id} list={l} />
          ))}
        </div>
        {mine.playlists.length <= 1 && (
          <p className="mt-6 text-[14px] text-text-2">Make a playlist with Save under any video.</p>
        )}
      </section>
    </div>
  );
}

export default function LibraryPage() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-[1284px] px-6 py-6"><div className="h-6 w-40 bg-skeleton" /></div>}>
      <Library />
    </Suspense>
  );
}
