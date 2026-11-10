"use client";

import { useRef, type PointerEvent as ReactPointerEvent } from "react";
import { Avatar } from "@/components/Avatar";
import { useMyVideos } from "@/components/cards/CardsEditor";
import {
  END_LABELS,
  END_MAX,
  END_SHOW_MAX,
  END_SHOW_MIN,
  END_SIZES,
  clampPlace,
  elementProblem,
  newElement,
  overlaps,
  type EndDraft,
  type EndKind,
} from "@/lib/endscreens/rules";
import { useSession } from "@/lib/store/session";

const input =
  "h-10 w-full rounded-[4px] border border-[var(--input-border)] bg-surface px-3 text-[14px] text-text outline-none placeholder:text-text-3 focus:border-[var(--focus)] disabled:opacity-60";

const ADD: EndKind[] = ["video", "subscribe", "channel"];

/**
 * The end screen editor of the uploader's "Video elements" step and the
 * studio's video editor (045), like 2020: up to 4 elements (subscribe, one of
 * your videos, another channel) dragged into place on a small player, each
 * shown for the last 5 to 20 seconds. Controlled: the caller keeps the
 * elements and saves them.
 */
export function EndScreenEditor({
  value,
  onChange,
  excludeId = null,
  disabled = false,
}: {
  value: EndDraft[];
  onChange: (next: EndDraft[]) => void;
  /** The video the end screen is on, left out of the video list. */
  excludeId?: string | null;
  disabled?: boolean;
}) {
  const list = useMyVideos();
  const me = useSession((s) => s.user);
  const canvas = useRef<HTMLDivElement>(null);
  const drag = useRef<{ i: number; dx: number; dy: number; pointer: number } | null>(null);
  const set = (i: number, patch: Partial<EndDraft>) => onChange(value.map((d, j) => (j === i ? { ...d, ...patch } : d)));
  const remove = (i: number) => onChange(value.filter((_, j) => j !== i));
  const videos = list.state === "ready" ? list.videos.filter((v) => v.id !== excludeId) : [];
  const titleOf = (id: string) => videos.find((v) => v.id === id)?.title ?? "";

  function down(e: ReactPointerEvent<HTMLDivElement>, i: number) {
    if (disabled || !canvas.current) return;
    const r = canvas.current.getBoundingClientRect();
    const d = value[i];
    drag.current = { i, dx: (e.clientX - r.left) / r.width - d.x, dy: (e.clientY - r.top) / r.height - d.y, pointer: e.pointerId };
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
  }

  function move(e: ReactPointerEvent<HTMLDivElement>) {
    const g = drag.current;
    if (!g || g.pointer !== e.pointerId || !canvas.current) return;
    const r = canvas.current.getBoundingClientRect();
    const d = value[g.i];
    const next = clampPlace(d.kind, (e.clientX - r.left) / r.width - g.dx, (e.clientY - r.top) / r.height - g.dy);
    if (next.x !== d.x || next.y !== d.y) set(g.i, next);
  }

  function up(e: ReactPointerEvent<HTMLDivElement>) {
    if (drag.current?.pointer === e.pointerId) drag.current = null;
  }

  return (
    <div data-end-editor={value.length}>
      {/* The last seconds of the video, with the elements where viewers see them. */}
      <div
        ref={canvas}
        className="relative aspect-video w-full max-w-[560px] touch-none select-none overflow-hidden rounded-[2px] bg-[#1f1f1f]"
        data-end-canvas
      >
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-[12px] text-white/30">Drag the elements into place</div>
        {value.map((d, i) => {
          const size = END_SIZES[d.kind];
          const clash = value.some((o, j) => j !== i && overlaps(d, o));
          const round = d.kind !== "video";
          return (
            <div
              key={i}
              role="button"
              tabIndex={0}
              aria-label={`${END_LABELS[d.kind]} element ${i + 1}: drag to move`}
              onPointerDown={(e) => down(e, i)}
              onPointerMove={move}
              onPointerUp={up}
              onPointerCancel={up}
              onKeyDown={(e) => {
                const step = e.shiftKey ? 0.05 : 0.01;
                const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
                const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
                if (!dx && !dy) return;
                e.preventDefault();
                set(i, clampPlace(d.kind, d.x + dx, d.y + dy));
              }}
              style={{ left: `${d.x * 100}%`, top: `${d.y * 100}%`, width: `${size.w * 100}%`, height: `${size.h * 100}%` }}
              className={`absolute grid cursor-grab place-items-center overflow-hidden text-center text-[11px] font-medium text-white outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)] active:cursor-grabbing ${
                round ? "rounded-full" : "rounded-[2px]"
              } ${clash ? "ring-2 ring-[var(--error)]" : "ring-1 ring-white/60"} bg-[#3a3a3a]`}
              data-end-element={d.kind}
            >
              {d.kind === "video" && d.videoId ? (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/api/media/${d.videoId}/thumb-1.webp`} alt="" className="absolute inset-0 h-full w-full object-cover" draggable={false} />
                  <span className="absolute inset-x-0 bottom-0 truncate bg-black/70 px-1 py-0.5 text-[10px]">{titleOf(d.videoId) || "Video"}</span>
                </>
              ) : d.kind === "subscribe" && me ? (
                <span className="pointer-events-none absolute inset-0 grid place-items-center">
                  <Avatar name={me.displayName || me.username} url={me.avatarUrl} size={64} />
                </span>
              ) : (
                <span className="px-1">{d.kind === "channel" && d.handle ? d.handle : END_LABELS[d.kind]}</span>
              )}
              <span className="pointer-events-none absolute left-1 top-1 grid h-4 w-4 place-items-center rounded-full bg-black/70 text-[10px]">{i + 1}</span>
            </div>
          );
        })}
      </div>

      <ol className="mt-3 space-y-3">
        {value.map((d, i) => {
          const problem = d.kind === "video" && !d.videoId ? null : elementProblem(d);
          return (
            <li key={i} className="rounded-[4px] border border-divider p-3" data-end-row={d.kind}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[13px] font-medium text-text">
                  {i + 1}. {END_LABELS[d.kind]}
                  {d.kind === "subscribe" && <span className="font-normal text-text-2"> (your channel)</span>}
                </span>
                <button
                  type="button"
                  onClick={() => remove(i)}
                  disabled={disabled}
                  aria-label={`Remove element ${i + 1}`}
                  className="grid h-8 w-8 place-items-center rounded-full text-icon hover:bg-hover disabled:opacity-60"
                >
                  <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden>
                    <path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" fill="currentColor" />
                  </svg>
                </button>
              </div>
              {d.kind === "video" && (
                <select
                  aria-label="Video"
                  value={d.videoId}
                  disabled={disabled || list.state !== "ready"}
                  onChange={(e) => set(i, { videoId: e.target.value })}
                  className={`${input} mt-2`}
                  data-end-video
                >
                  <option value="">{list.state === "loading" ? "Loading your videos..." : list.state === "failed" ? "Couldn't load your videos" : "Pick one of your videos"}</option>
                  {d.videoId && !videos.some((v) => v.id === d.videoId) && <option value={d.videoId}>The video picked before</option>}
                  {videos.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.title}
                      {v.visibility === "unlisted" ? " (unlisted)" : ""}
                    </option>
                  ))}
                </select>
              )}
              {d.kind === "channel" && (
                <input
                  aria-label="Channel handle"
                  value={d.handle}
                  disabled={disabled}
                  onChange={(e) => set(i, { handle: e.target.value })}
                  placeholder="@channel"
                  className={`${input} mt-2`}
                  data-end-handle
                />
              )}
              <label className="mt-2 block">
                <span className="flex items-center justify-between text-[12px] text-text-2">
                  <span>Shows for the last</span>
                  <span className="font-medium text-text" data-end-show>
                    {d.showS} seconds
                  </span>
                </span>
                <input
                  type="range"
                  min={END_SHOW_MIN}
                  max={END_SHOW_MAX}
                  step={1}
                  value={d.showS}
                  disabled={disabled}
                  onChange={(e) => set(i, { showS: Number(e.target.value) })}
                  aria-label="Seconds before the end"
                  className="mt-1 w-full accent-[var(--studio-accent,var(--link))]"
                />
              </label>
              {problem && <p className="mt-1.5 text-[12px] text-[var(--error)]">{problem}</p>}
            </li>
          );
        })}
      </ol>

      <div className="mt-3 flex flex-wrap items-center gap-1">
        {ADD.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => onChange([...value, newElement(k, value)])}
            disabled={disabled || value.length >= END_MAX || (k === "subscribe" && value.some((d) => d.kind === "subscribe"))}
            className="inline-flex h-9 items-center gap-1 rounded-[2px] px-2 text-[14px] font-medium uppercase text-[var(--studio-accent,var(--link))] hover:bg-hover disabled:opacity-50"
            data-end-add={k}
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden>
              <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" fill="currentColor" />
            </svg>
            {END_LABELS[k]}
          </button>
        ))}
        <span className="ml-1 text-[12px] text-text-3">
          {value.length}/{END_MAX}
        </span>
      </div>
    </div>
  );
}
