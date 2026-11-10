import Link from "next/link";
import { Thumb } from "@/components/Thumb";
import { PlaylistPlayIcon, WatchLaterIcon } from "@/components/icons";
import { playlistHref, watchInList, type PlaylistSummary } from "@/lib/playlists/rules";
import { VisibilityIcon } from "./VisibilityIcon";

/**
 * A playlist in the library, the 2020 card: the first video's picture with
 * the count and the playlist mark on a dark band down the right, the name,
 * and VIEW FULL PLAYLIST. The picture plays it from the start.
 */
export function PlaylistCard({ list }: { list: PlaylistSummary }) {
  const page = playlistHref(list.id);
  const play = list.firstVideoId ? watchInList(list.firstVideoId, list.id) : page;
  const Mark = list.kind === "watch_later" ? WatchLaterIcon : PlaylistPlayIcon;
  return (
    <article data-playlist-card={list.kind}>
      <Link href={play} className="relative block aspect-video overflow-hidden bg-skeleton" aria-label={`Play ${list.title}`}>
        {list.thumbnail && <Thumb src={list.thumbnail} alt="" sizes="(min-width: 1024px) 25vw, 50vw" />}
        <span className="absolute inset-y-0 right-0 flex w-[40%] flex-col items-center justify-center gap-1 bg-black/80 text-white">
          <span className="text-[18px] font-normal leading-6">{list.count}</span>
          <Mark className="h-6 w-6" />
        </span>
      </Link>
      <h3 className="mt-2 flex items-start gap-1 text-[14px] font-medium leading-5 text-text">
        <Link href={page} className="line-clamp-2 min-w-0 flex-1">
          {list.title}
        </Link>
        <VisibilityIcon visibility={list.visibility} className="h-4 w-4" />
      </h3>
      <Link href={page} className="mt-1 block text-[13px] font-medium uppercase leading-[18px] text-text-2 hover:text-text">
        View full playlist
      </Link>
    </article>
  );
}
