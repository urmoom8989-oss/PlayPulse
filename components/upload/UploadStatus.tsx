"use client";

import { uploadStatusText, type LiveStatus } from "@/lib/processing/status";
import { useLiveStatuses } from "@/lib/processing/useLiveStatus";

/**
 * What the encoder is doing with the video that was just uploaded, asked
 * every 5 seconds until it is done: "Processing...", the percent, "Your video
 * can be watched now" while HD is made (038), then done.
 */
export function UploadStatus({ videoId }: { videoId: string }) {
  const [video] = useLiveStatuses<LiveStatus>(
    [{ id: videoId, status: "uploaded", progress: 0, job: null, thumbnailUrl: null, error: null }],
    true,
  );
  const { title, line, pct } = uploadStatusText(video);
  return (
    <div data-upload-status={video.status} className="mt-5 flex w-full max-w-[420px] flex-col items-center">
      <p role="status" className="text-[20px] leading-7 text-text">
        {title}
      </p>
      {pct !== null && (
        <div
          role="progressbar"
          aria-label="Processing"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
          className="mt-3 h-1 w-full overflow-hidden rounded-full bg-[var(--progress-track)]"
        >
          <div className="h-full bg-[var(--progress)] transition-[width] duration-500" style={{ width: `${pct}%` }} />
        </div>
      )}
      {line && <p className={`mt-2 text-[13px] leading-5 ${video.status === "failed" ? "text-[var(--error)]" : "text-text-2"}`}>{line}</p>}
    </div>
  );
}
