"use client";

import { useState } from "react";
import { draftFromElement, endErrorText, endProblem, toEndPayload, type EndDraft, type EndElement } from "@/lib/endscreens/rules";
import { EndScreenEditor } from "./EndScreenEditor";

/** The End screen box of the studio's video editor: the editor and its own Save (045). */
export function StudioEndScreen({ videoId, initial, preview = false }: { videoId: string; initial: EndElement[]; preview?: boolean }) {
  const start = initial.map(draftFromElement);
  const [saved, setSaved] = useState<EndDraft[]>(start);
  const [els, setEls] = useState<EndDraft[]>(start);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ error: boolean; text: string } | null>(null);
  const dirty = JSON.stringify(els) !== JSON.stringify(saved);
  const problem = endProblem(els);

  async function save() {
    if (problem) return setNote({ error: true, text: problem });
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/studio/end-screen", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ videoId, elements: els.map(toEndPayload) }),
      });
      const json = (await res.json().catch(() => ({}))) as { saved?: number; error?: string };
      if (!res.ok || json.error) throw new Error(json.error ?? "failed");
      setSaved(els);
      setNote({ error: false, text: json.saved ? `End screen saved (${json.saved} element${json.saved === 1 ? "" : "s"})` : "End screen removed" });
    } catch (err) {
      setNote({ error: true, text: endErrorText(err instanceof Error ? err.message : "failed") });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div data-studio-end-screen>
      <EndScreenEditor value={els} onChange={setEls} excludeId={videoId} disabled={busy || preview} />
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button type="button" onClick={save} disabled={!dirty || busy || preview} className="btn-blue" data-end-save>
          {busy ? "Saving..." : "Save end screen"}
        </button>
        {dirty && !busy && (
          <button type="button" onClick={() => setEls(saved)} className="btn-text">
            Undo changes
          </button>
        )}
        {(note || (dirty && problem)) && (
          <span role="status" className={`text-[13px] ${note?.error || (!note && problem) ? "text-[var(--error)]" : "text-text-2"}`}>
            {note?.text ?? problem}
          </span>
        )}
      </div>
    </div>
  );
}
