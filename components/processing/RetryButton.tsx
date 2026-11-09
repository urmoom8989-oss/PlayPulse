"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { retryMessage } from "@/lib/processing/retry";
import { ReplayIcon } from "../icons";

/**
 * Retry for a video whose processing failed (033_retry_failed.sql): the file
 * already uploaded is processed again. On success the page reloads its data,
 * so the video shows as processing. With onResult the caller shows the
 * message (the studio's toast); without it, it shows under the button.
 */
export function RetryButton({
  videoId,
  className = "",
  preview = false,
  onResult,
}: {
  videoId: string;
  className?: string;
  /** The studio preview without a database: nothing is sent. */
  preview?: boolean;
  onResult?: (message: string, ok: boolean) => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function retry() {
    if (busy) return;
    setBusy(true);
    setNote(null);
    let code: string | null = null;
    if (!preview) {
      try {
        const res = await fetch(`/api/videos/${videoId}/retry`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        });
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) code = body.error ?? "failed";
      } catch {
        code = "failed";
      }
    }
    setBusy(false);
    const text = retryMessage(code);
    if (onResult) onResult(text, code === null);
    else setNote(text);
    if (code === null && !preview) router.refresh();
  }

  return (
    <>
      <button type="button" onClick={retry} disabled={busy} data-retry={videoId} className={className}>
        <ReplayIcon className="h-5 w-5" />
        {busy ? "Retrying" : "Retry"}
      </button>
      {note && (
        <span role="status" data-retry-note className="block text-[13px]">
          {note}
        </span>
      )}
    </>
  );
}
