import Link from "next/link";
import type { StudioVideo } from "@/lib/upload/server";
import { PublishButton } from "@/components/upload/PublishButton";
import { StatusBadge } from "@/components/upload/StatusBadge";

export function OwnerVideos({ videos }: { videos: StudioVideo[] }) {
  if (videos.length === 0) return null;
  return (
    <section className="mx-auto max-w-[1284px] px-4 pb-6 sm:px-6" data-owner-videos>
      <h2 className="text-[16px] font-medium leading-6 text-text">Your videos</h2>
      <p className="mt-1 text-[13px] text-text-2">Private uploads are visible here only to you. Publishing makes them public when ready.</p>
      <ul className="mt-4 divide-y divide-divider rounded-[2px] border border-divider bg-surface">
        {videos.map((video) => (
          <li key={video.id} className="flex flex-wrap items-center gap-4 p-3">
            {video.thumbnailUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={video.thumbnailUrl} alt="" className="aspect-video w-32 shrink-0 rounded-[2px] bg-black object-cover" />
            ) : (
              <div className="grid aspect-video w-32 shrink-0 place-items-center rounded-[2px] bg-[var(--skeleton)] text-[11px] text-text-3">
                {video.status === "failed" ? "Upload failed" : "Processing"}
              </div>
            )}
            <div className="min-w-[180px] flex-1">
              <Link href={`/watch?v=${video.id}`} className="line-clamp-2 text-[14px] font-medium text-text hover:underline">
                {video.title}
              </Link>
              <p className="mt-1 text-[12px] text-text-2">
                {video.category} · {video.visibility === "public" ? "Public after processing" : video.visibility}
              </p>
              <div className="mt-1 flex items-center gap-2">
                <StatusBadge status={video.status} />
                {video.progress !== null && <span className="text-[12px] text-text-2">{video.progress}%</span>}
              </div>
            </div>
            {video.visibility !== "public" && video.status !== "failed" && video.status !== "uploading" && (
              <PublishButton videoId={video.id} />
            )}
            <Link href={`/studio/video/${video.id}/edit`} className="btn-text">
              Edit
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
