"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function PublishButton({ videoId, successText = "Published" }: { videoId: string; successText?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [published, setPublished] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function publish() {
    if (busy || published) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/upload/publish", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ videoId }),
      });
      const result = (await response.json().catch(() => ({}))) as { message?: string; error?: string };
      if (!response.ok) throw new Error(result.message || result.error || "Could not publish the video.");
      setPublished(true);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not publish the video.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      {published ? (
        <p role="status" className="text-[14px] font-medium text-text">{successText}</p>
      ) : (
        <button type="button" className="btn-blue" disabled={busy} onClick={() => void publish()}>
          {busy ? "Publishing" : "Publish"}
        </button>
      )}
      {error && <p role="alert" className="mt-2 text-[13px] text-[var(--error)]">{error}</p>}
    </div>
  );
}
