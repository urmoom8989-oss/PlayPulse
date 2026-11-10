import { GlobeIcon, LinkIcon, LockIcon } from "@/components/icons";
import type { PlaylistVisibility } from "@/lib/playlists/rules";

/** The little icon after a playlist's name: a lock, a link or a globe. */
export function VisibilityIcon({ visibility, className = "h-[18px] w-[18px]" }: { visibility: PlaylistVisibility; className?: string }) {
  const Icon = visibility === "private" ? LockIcon : visibility === "unlisted" ? LinkIcon : GlobeIcon;
  const label = visibility === "private" ? "Private" : visibility === "unlisted" ? "Unlisted" : "Public";
  return (
    <span title={label} aria-label={label} className="inline-grid shrink-0 place-items-center text-icon">
      <Icon className={className} />
    </span>
  );
}
