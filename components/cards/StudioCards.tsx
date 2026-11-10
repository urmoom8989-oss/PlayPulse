"use client";

import { useState } from "react";
import { cardErrorText, draftFrom, toPayload, type CardDraft, type WatchCard } from "@/lib/cards/rules";
import { CardsEditor } from "./CardsEditor";

/** The Cards box of the studio's video editor: the list and its own Save (041). */
export function StudioCards({ videoId, initial, durationS, preview = false }: { videoId: string; initial: WatchCard[]; durationS: number | null; preview?: boolean }) {
  const start = initial.map(draftFrom);
  const [saved, setSaved] = useState<CardDraft[]>(start);
  const [cards, setCards] = useState<CardDraft[]>(start);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ error: boolean; text: string } | null>(null);
  const dirty = JSON.stringify(cards) !== JSON.stringify(saved);
  const checked = toPayload(cards, durationS);

  async function save() {
    if ("error" in checked) return setNote({ error: true, text: `Card ${checked.index + 1}: ${checked.error}` });
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/studio/cards", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ videoId, cards: checked.cards }),
      });
      const json = (await res.json().catch(() => ({}))) as { saved?: number; error?: string };
      if (!res.ok || json.error) throw new Error(json.error ?? "failed");
      setSaved(cards);
      setNote({ error: false, text: json.saved ? `${json.saved} card${json.saved === 1 ? "" : "s"} saved` : "Cards removed" });
    } catch (err) {
      setNote({ error: true, text: cardErrorText(err instanceof Error ? err.message : "failed") });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div data-studio-cards>
      <CardsEditor value={cards} onChange={setCards} durationS={durationS} disabled={busy || preview} />
      <div className="mt-3 flex items-center gap-3">
        <button type="button" onClick={save} disabled={!dirty || busy || preview} className="btn-blue" data-cards-save>
          {busy ? "Saving..." : "Save cards"}
        </button>
        {dirty && !busy && (
          <button type="button" onClick={() => setCards(saved)} className="btn-text">
            Undo changes
          </button>
        )}
        {note && (
          <span role="status" className={`text-[13px] ${note.error ? "text-[var(--error)]" : "text-text-2"}`}>
            {note.text}
          </span>
        )}
      </div>
    </div>
  );
}
