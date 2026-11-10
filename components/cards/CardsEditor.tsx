"use client";

import { useEffect, useState } from "react";
import {
  CARDS_MAX,
  CARD_MESSAGE_MAX,
  KIND_HINTS,
  KIND_LABELS,
  cardProblem,
  emptyCard,
  formatStart,
  parseStart,
  type CardDraft,
  type CardKind,
  type CardVideoChoice,
} from "@/lib/cards/rules";

const KINDS: CardKind[] = ["video", "channel", "link"];
const input =
  "h-10 w-full rounded-[4px] border border-[var(--input-border)] bg-surface px-3 text-[14px] text-text outline-none placeholder:text-text-3 focus:border-[var(--focus)] disabled:opacity-60";

type VideoList = { state: "loading" } | { state: "ready"; videos: CardVideoChoice[] } | { state: "failed" };

/** Your public and unlisted videos, asked for once (GET /api/studio/cards/videos). */
function useMyVideos(): VideoList {
  const [list, setList] = useState<VideoList>({ state: "loading" });
  useEffect(() => {
    let live = true;
    fetch("/api/studio/cards/videos", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((json: { videos?: CardVideoChoice[] }) => live && setList({ state: "ready", videos: json.videos ?? [] }))
      .catch(() => live && setList({ state: "failed" }));
    return () => {
      live = false;
    };
  }, []);
  return list;
}

/**
 * The card list of the uploader's "Video elements" step and the studio's
 * video editor (041), like 2020: up to 5 cards, each one of your videos
 * (picked from a list), a channel or a website, with a message of up to 30
 * characters and the time it shows up, set with a slider along the video.
 * Controlled: the caller keeps the cards and saves them.
 */
export function CardsEditor({
  value,
  onChange,
  durationS = null,
  excludeId = null,
  disabled = false,
  showErrors = true,
}: {
  value: CardDraft[];
  onChange: (next: CardDraft[]) => void;
  /** The video's length: the slider runs from 0 to it. Unknown: the time is typed. */
  durationS?: number | null;
  /** The video the cards are on, left out of the list. */
  excludeId?: string | null;
  disabled?: boolean;
  /** Problems under each card (off until there is something to check against). */
  showErrors?: boolean;
}) {
  const list = useMyVideos();
  const set = (i: number, patch: Partial<CardDraft>) => onChange(value.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const remove = (i: number) => onChange(value.filter((_, j) => j !== i));
  const max = durationS && durationS > 0 ? Math.floor(durationS) : null;

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
                  onChange={(e) => set(i, { kind: e.target.value as CardKind, target: "", label: undefined })}
                  className={input}
                >
                  {KINDS.map((k) => (
                    <option key={k} value={k}>
                      {KIND_LABELS[k]}
                    </option>
                  ))}
                </select>
                {card.kind === "video" ? (
                  <VideoChoice card={card} list={list} excludeId={excludeId} disabled={disabled} onPick={(id) => set(i, { target: id, label: undefined })} />
                ) : (
                  <input
                    aria-label={KIND_HINTS[card.kind]}
                    value={card.target}
                    disabled={disabled}
                    onChange={(e) => set(i, { target: e.target.value })}
                    placeholder={card.kind === "channel" ? "@channel" : "https://example.com"}
                    className={input}
                    inputMode={card.kind === "link" ? "url" : "text"}
                  />
                )}
              </div>
              <div className={`mt-2 grid gap-2 ${max ? "" : "sm:grid-cols-[1fr_120px]"}`}>
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
                {max ? (
                  <TimeSlider value={Math.min(parseStart(card.start) ?? 0, max)} max={max} disabled={disabled} onChange={(s) => set(i, { start: formatStart(s) })} />
                ) : (
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
                )}
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

/** The video card's list: your public and unlisted videos, newest first. */
function VideoChoice({
  card,
  list,
  excludeId,
  disabled,
  onPick,
}: {
  card: CardDraft;
  list: VideoList;
  excludeId: string | null;
  disabled: boolean;
  onPick: (id: string) => void;
}) {
  const videos = list.state === "ready" ? list.videos.filter((v) => v.id !== excludeId) : [];
  // A card saved before that points at a video not in the list keeps it as a choice.
  const other = card.target && !videos.some((v) => v.id === card.target) ? card.target : null;
  const empty = list.state === "ready" && videos.length === 0 && !other;
  return (
    <select
      aria-label="Video"
      value={card.target}
      disabled={disabled || list.state === "loading" || empty}
      onChange={(e) => onPick(e.target.value)}
      className={input}
      data-card-video-choice
    >
      <option value="" disabled>
        {list.state === "loading"
          ? "Loading your videos..."
          : list.state === "failed"
            ? "Couldn't load your videos"
            : empty
              ? "No public or unlisted videos yet"
              : "Choose one of your videos"}
      </option>
      {other && <option value={other}>{card.label ?? "A video from before"}</option>}
      {videos.map((v) => (
        <option key={v.id} value={v.id}>
          {v.title}
          {v.visibility === "unlisted" ? " (unlisted)" : ""}
        </option>
      ))}
    </select>
  );
}

/** When the card shows up: a slider along the whole video, with the time beside it. */
function TimeSlider({ value, max, disabled, onChange }: { value: number; max: number; disabled: boolean; onChange: (s: number) => void }) {
  return (
    <div className="flex h-10 items-center gap-3" data-card-time-slider>
      <span className="shrink-0 text-[12px] text-text-2">Shows up at</span>
      <input
        type="range"
        min={0}
        max={max}
        step={1}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label="Shows up at"
        aria-valuetext={formatStart(value)}
        className="h-1 min-w-0 flex-1 cursor-pointer accent-[var(--studio-accent,var(--link))] disabled:cursor-default"
      />
      <span className="w-14 shrink-0 text-right text-[13px] tabular-nums text-text" data-card-time>
        {formatStart(value)}
      </span>
      <span className="hidden shrink-0 text-[12px] text-text-3 sm:inline">/ {formatStart(max)}</span>
    </div>
  );
}
