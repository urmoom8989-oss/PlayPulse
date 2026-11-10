import { Suspense } from "react";
import { EmptyState } from "@/components/EmptyState";
import { PlaylistView } from "@/components/playlists/PlaylistView";
import { playlistPage } from "@/lib/playlists/server";

// /playlist?list=<id>, the 2020 address of a playlist (043_playlists.sql).

export const metadata = { title: "Playlist | PlayPulse" };

function PlaylistSkeleton() {
  return (
    <div className="flex flex-col search:flex-row" data-playlist-state="loading">
      <div className="bg-surface p-6 search:w-[360px]">
        <div className="aspect-video bg-skeleton" />
        <div className="mt-4 h-6 w-3/4 bg-skeleton" />
        <div className="mt-2 h-4 w-1/2 bg-skeleton" />
      </div>
      <div className="flex-1 p-4">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="flex gap-3 py-2">
            <div className="aspect-video w-[120px] bg-skeleton" />
            <div className="flex-1">
              <div className="h-4 w-3/4 bg-skeleton" />
              <div className="mt-2 h-3 w-1/3 bg-skeleton" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

async function Playlist({ searchParams }: { searchParams: PageProps<"/playlist">["searchParams"] }) {
  const list = (await searchParams).list;
  const state = await playlistPage(typeof list === "string" ? list : null);
  switch (state.kind) {
    case "off":
      return (
        <div data-playlist-state="off">
          <EmptyState title="Playlists aren't switched on yet." hint="Check back soon." cards={0} />
        </div>
      );
    case "no-db":
      return (
        <div data-playlist-state="no-db">
          <EmptyState title="database not connected" hint="Add the publishable key to .env.local (see .env.example) and restart." cards={0} />
        </div>
      );
    case "not-set-up":
      return (
        <div data-playlist-state="not-set-up">
          <EmptyState title="Playlists aren't set up yet." hint="Run supabase/migrations/043_playlists.sql in the Supabase SQL editor." cards={0} />
        </div>
      );
    case "missing":
      return (
        <div data-playlist-state="missing">
          <EmptyState title="This playlist doesn't exist." hint="It's private, it was deleted, or the link is wrong." cards={0} />
        </div>
      );
    case "ready":
      return (
        <div data-playlist-state="ready">
          <PlaylistView key={state.header.id} header={state.header} items={state.items} />
        </div>
      );
  }
}

export default function PlaylistPage({ searchParams }: PageProps<"/playlist">) {
  return (
    <Suspense fallback={<PlaylistSkeleton />}>
      <Playlist searchParams={searchParams} />
    </Suspense>
  );
}
