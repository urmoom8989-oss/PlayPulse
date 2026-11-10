"use client";

import { CARDS_MAX, CARD_MESSAGE_MAX, KIND_HINTS, KIND_LABELS, cardProblem, emptyCard, type CardDraft, type CardKind } from "@/lib/cards/rules";

const KINDS: CardKind[] = ["video", "channel", "link"];
const input =
  "h-10 w-full rounded-[4px] border border-[var(--input-border)] bg-surface px-3 text-[14px] text-text outline-none placeholder:text-text-3 focus:border-[var(--focus)] disabled:opacity-60";

/**
 * The card list of the uploader's "Video elements" step and the studio's
 * video editor (041), like 2020: up to 5 cards, each a video, a channel or a
 * website, with a message of up to 30 characters and the time it shows up.
 * Controlled: the caller keeps the cards and saves them.
 */
export function CardsEditor({
  value,
  onChange,
  durationS = null,
  disabled = false,
  showErrors = true,
}: {
  value: CardDraft[];
  onChange: (next: CardDraft[]) => void;
  durationS?: number | null;
  disabled?: boolean;
  /** Problems under each card (off until there is something to check against). */
  showErrors?: boolean;
}) {
  const set = (i: number, patch: Partial<CardDraft>) => onChange(value.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const remove = (i: number) => onChange(value.filter((_, j) => j !== i));

  return (
    <div data-cards-editor={value.length}>
      <ol className="space-y-3">
        {value.map((card, i) => {
          const problem = showErrors && card.target.trim() !== "" ? cardProblem(card, durationS) : null;
          return (
            <li key={i} data-card-row={card.kind} className="rounded-[4px] border border-divider p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[13px] font-medium text-text">Card {i + 1}</span>
                <button
                  type="button"
                  onClick={() => remove(i)}
                  disabled={disabled}
                  aria-label={`Remove card ${i + 1}`}
                  className="grid h-8 w-8 place-items-center rounded-full text-icon hover:bg-hover disabled:opacity-60"
                >
                  <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden>
                    <path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" fill="currentColor" />
                  </svg>
                </button>
              </div>
              <div className="mt-2 grid gap-2 sm:grid-cols-[120px_1fr]">
                <select
                  aria-label="Card type"
                  value={card.kind}
                  disabled={disabled}
                  onChange={(e) => set(i, { kind: e.target.value as CardKind, target: "" })}
                  className={input}
                >
                  {KINDS.map((k) => (
                    <option key={k} value={k}>
                      {KIND_LABELS[k]}
                    </option>
                  ))}
                </select>
                <input
                  aria-label={KIND_HINTS[card.kind]}
                  value={card.target}
                  disabled={disabled}
                  onChange={(e) => set(i, { target: e.target.value })}
                  placeholder={card.kind === "video" ? "https://.../watch?v=..." : card.kind === "channel" ? "@channel" : "https://example.com"}
                  className={input}
                  inputMode={card.kind === "link" ? "url" : "text"}
                />
              </div>
              <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_120px]">
                <label className="relative block">
                  <span className="sr-only">Message, up to {CARD_MESSAGE_MAX} characters</span>
                  <input
                    value={card.message}
                    maxLength={CARD_MESSAGE_MAX}
                    disabled={disabled}
                    onChange={(e) => set(i, { message: e.target.value })}
                    placeholder="Message (optional)"
                    className={`${input} pr-14`}
                  />
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[12px] text-text-3">
                    {card.message.length}/{CARD_MESSAGE_MAX}
                  </span>
                </label>
                <label className="block">
                  <span className="sr-only">Shows up at</span>
                  <input
                    value={card.start}
                    disabled={disabled}
                    onChange={(e) => set(i, { start: e.target.value })}
                    placeholder="0:00"
                    aria-label="Shows up at (m:ss)"
                    className={input}
                    inputMode="numeric"
                  />
                </label>
              </div>
              {problem && (
                <p className="mt-1.5 text-[12px] text-[var(--error)]" data-card-problem>
                  {problem}
                </p>
              )}
            </li>
          );
        })}
      </ol>
      <button
        type="button"
        onClick={() => onChange([...value, emptyCard()])}
        disabled={disabled || value.length >= CARDS_MAX}
        className="mt-3 inline-flex h-9 items-center gap-1 rounded-[2px] px-2 text-[14px] font-medium uppercase text-[var(--studio-accent,var(--link))] hover:bg-hover disabled:opacity-50"
        data-card-add
      >
        <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden>
          <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" fill="currentColor" />
        </svg>
        Add card
      </button>
      <span className="ml-2 text-[12px] text-text-3">
        {value.length}/{CARDS_MAX}
      </span>
    </div>
  );
}
