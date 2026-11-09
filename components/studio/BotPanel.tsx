"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  BOT_LIMITS,
  WINDOWS,
  amountOf,
  amountsText,
  botErrorMessage,
  orderPercent,
  orderProblem,
  orderStatusText,
  suggestFor,
  windowText,
  type BotOrder,
  type BotPanel as Panel,
  type BotVideo,
  type WindowMinutes,
} from "@/lib/bots/rules";
import { formatTime } from "@/lib/watch/format";
import { FilterIcon } from "../icons";

const n = (v: number) => Math.max(0, Math.floor(v)).toLocaleString("en-US");
/** While orders are running, the page asks the server for their progress this often. */
const REFRESH_MS = 30_000;

type Send = (body: Record<string, unknown>, done: string) => Promise<boolean>;

function NumberField({ label, value, onChange, max, name }: { label: string; value: string; onChange: (v: string) => void; max: number; name: string }) {
  return (
    <label className="block min-w-0">
      <span className="mb-1 block text-[12px] font-medium text-text-2">{label}</span>
      <input
        type="text"
        inputMode="numeric"
        value={value}
        placeholder="0"
        onChange={(e) => onChange(e.target.value.replace(/[^\d,]/g, ""))}
        aria-label={label}
        title={`Up to ${n(max)}`}
        data-bot-field={name}
        className="field !h-10 !text-[14px]"
      />
    </label>
  );
}

function WindowSelect({ value, onChange }: { value: WindowMinutes; onChange: (v: WindowMinutes) => void }) {
  return (
    <label className="block min-w-0">
      <span className="mb-1 block text-[12px] font-medium text-text-2">Delivery</span>
      <select
        value={value}
        onChange={(e) => onChange(Number(e.target.value) as WindowMinutes)}
        aria-label="Delivery"
        data-bot-field="window"
        className="field !h-10 cursor-pointer !text-[14px]"
      >
        {WINDOWS.map((w) => (
          <option key={w.minutes} value={w.minutes} className="bg-surface text-text">
            {w.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/** The form under a video: how many of each, and how fast. */
function VideoOrderForm({ video, send, busy, onClose }: { video: BotVideo; send: Send; busy: boolean; onClose: () => void }) {
  const [views, setViews] = useState("");
  const [likes, setLikes] = useState("");
  const [dislikes, setDislikes] = useState("");
  const [comments, setComments] = useState("");
  const [over, setOver] = useState<WindowMinutes>(1440);
  const amounts = { views: amountOf(views), likes: amountOf(likes), dislikes: amountOf(dislikes), comments: amountOf(comments), subscribers: 0 };
  const problem = orderProblem({ ...amounts, videoId: video.id, overMinutes: over });
  const windowLabel = WINDOWS.find((w) => w.minutes === over)?.label.toLowerCase() ?? "";

  function match() {
    const s = suggestFor(amounts.views);
    setLikes(String(s.likes));
    setDislikes(String(s.dislikes));
    setComments(video.commentsMode === "on" ? String(s.comments) : "0");
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (problem) return;
    const ok = await send({ action: "order", videoId: video.id, ...amounts, overMinutes: over }, `Ordered ${amountsText(amounts)}.`);
    if (ok) onClose();
  }

  return (
    <form onSubmit={submit} className="mt-3 rounded-[2px] border border-divider bg-[var(--page)] p-4" data-bot-form={video.id}>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <NumberField label="Views" name="views" value={views} onChange={setViews} max={BOT_LIMITS.views} />
        <NumberField label="Likes" name="likes" value={likes} onChange={setLikes} max={BOT_LIMITS.likes} />
        <NumberField label="Dislikes" name="dislikes" value={dislikes} onChange={setDislikes} max={BOT_LIMITS.dislikes} />
        <NumberField label="Comments" name="comments" value={comments} onChange={setComments} max={BOT_LIMITS.comments} />
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
        <WindowSelect value={over} onChange={setOver} />
        <button
          type="button"
          onClick={match}
          disabled={!amounts.views}
          className="btn-text !h-10 !px-3 !text-[13px] !text-[var(--link)] disabled:opacity-40"
          data-bot-match
        >
          Match likes and comments to the views
        </button>
      </div>
      {video.commentsMode !== "on" && (
        <p className="mt-2 text-[12px] text-text-2">Comments are {video.commentsMode === "off" ? "off" : "held for review"} on this video, so bot comments are skipped.</p>
      )}
      <p className="mt-3 text-[13px] leading-[18px] text-text-2" data-bot-summary>
        {problem === "empty_order"
          ? "Enter how many to add. Comments are written from the video's captions."
          : problem
            ? botErrorMessage(problem)
            : `Adds ${amountsText(amounts)} ${over === 0 ? "right away" : windowLabel}.`}
      </p>
      <div className="mt-3 flex justify-end gap-2">
        <button type="button" className="btn-text" onClick={onClose}>
          Cancel
        </button>
        <button type="submit" className="btn-blue" disabled={busy || Boolean(problem)} data-bot-submit>
          Add bots
        </button>
      </div>
    </form>
  );
}

function SubscribersCard({ panel, send, busy }: { panel: Panel; send: Send; busy: boolean }) {
  const [subs, setSubs] = useState("");
  const [over, setOver] = useState<WindowMinutes>(1440);
  const amount = amountOf(subs);
  const problem = orderProblem({ views: 0, likes: 0, dislikes: 0, comments: 0, subscribers: amount, videoId: null, overMinutes: over });

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (problem) return;
    const ok = await send({ action: "order", videoId: null, views: 0, likes: 0, dislikes: 0, comments: 0, subscribers: amount, overMinutes: over }, `Ordered ${amountsText({ subscribers: amount })}.`);
    if (ok) setSubs("");
  }

  return (
    <section className="rounded-[2px] bg-surface p-4 shadow-[0_0_0_1px_var(--divider)] sm:p-6" data-bot-subscribers>
      <h2 className="text-[16px] font-medium text-text">Subscribers</h2>
      <p className="mt-1 text-[14px] text-text-2">
        <Link href={`/@${panel.channel.handle}`} className="text-text hover:underline">
          {panel.channel.name}
        </Link>{" "}
        has {n(panel.channel.subscribers)} subscribers.
      </p>
      <form onSubmit={submit} className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,180px)_minmax(0,220px)_auto] sm:items-end">
        <NumberField label="Subscribers to add" name="subscribers" value={subs} onChange={setSubs} max={BOT_LIMITS.subscribers} />
        <WindowSelect value={over} onChange={setOver} />
        <button type="submit" className="btn-blue sm:justify-self-start" disabled={busy || Boolean(problem)} data-bot-subscribe>
          Add subscribers
        </button>
      </form>
      {amount > BOT_LIMITS.subscribers && <p className="mt-2 text-[13px] text-[var(--error)]">{botErrorMessage("bad_amount")}</p>}
    </section>
  );
}

function VideoRow({ v, open, onOpen, send, busy }: { v: BotVideo; open: boolean; onOpen: (id: string | null) => void; send: Send; busy: boolean }) {
  const broadcast = v.broadcastKind === "premiere" ? "Premiere" : v.broadcastKind === "live" ? "live broadcast" : null;
  return (
    <li className="border-b border-divider px-4 py-3 last:border-0 sm:px-6" data-bot-video={v.id}>
      <div className="flex items-start gap-3">
        <Link href={v.isShort ? `/shorts/${v.id}` : `/watch?v=${v.id}`} className="relative block w-[100px] shrink-0 sm:w-[120px]">
          {v.thumbnail ? (
            // Signed links change on every load: next/image would only get in the way.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={v.thumbnail} alt="" className="aspect-video w-full rounded-[2px] bg-black object-cover" />
          ) : (
            <span className="block aspect-video w-full rounded-[2px] bg-skeleton" />
          )}
          {v.durationS ? (
            <span className="absolute bottom-1 right-1 bg-black/80 px-1 text-[11px] font-medium leading-4 text-white">{formatTime(v.durationS)}</span>
          ) : null}
        </Link>
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-[14px] leading-5 text-text">{v.title}</p>
          <p className="mt-0.5 text-[12px] leading-4 text-text-2">
            {n(v.views)} views · {n(v.likes)} likes · {n(v.dislikes)} dislikes · {n(v.comments)} comments
            {v.visibility === "unlisted" ? " · Unlisted" : ""}
          </p>
          {broadcast && (
            <label className="mt-2 flex cursor-pointer items-center gap-2 text-[13px] text-text">
              <input
                type="checkbox"
                role="switch"
                checked={v.liveBots}
                disabled={busy}
                onChange={(e) =>
                  void send(
                    { action: "live", videoId: v.id, on: e.target.checked },
                    e.target.checked ? `Bots will watch and chat during the ${broadcast}.` : `Bots won't join the ${broadcast}.`,
                  )
                }
                data-bot-live={v.id}
                className="h-4 w-4 shrink-0 accent-[var(--link)]"
              />
              Bot viewers and chat during the {broadcast}
            </label>
          )}
          {/* Phones: the button under the numbers, so the title keeps its room. */}
          {!open && (
            <button type="button" onClick={() => onOpen(v.id)} className="btn-text -ml-3 mt-1 !h-8 !px-3 !text-[var(--link)] sm:hidden" data-bot-open-phone={v.id}>
              Add bots
            </button>
          )}
        </div>
        {!open && (
          <button type="button" onClick={() => onOpen(v.id)} className="btn-text hidden shrink-0 !px-3 !text-[var(--link)] sm:inline-flex" data-bot-open={v.id}>
            Add bots
          </button>
        )}
      </div>
      {open && <VideoOrderForm video={v} send={send} busy={busy} onClose={() => onOpen(null)} />}
    </li>
  );
}

function OrderRow({ o, now, send, busy }: { o: BotOrder; now: number; send: Send; busy: boolean }) {
  const pct = orderPercent(o);
  return (
    <li className="border-b border-divider px-4 py-3 last:border-0 sm:px-6" data-bot-order={o.id} data-status={o.status}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="line-clamp-1 text-[14px] text-text">{o.videoId ? (o.videoTitle ?? "A deleted video") : "Channel subscribers"}</p>
          <p className="mt-0.5 text-[12px] leading-4 text-text-2">
            {amountsText(o.amounts)} · {windowText(o.startsAt, o.endsAt)}
          </p>
          <div className="mt-2 h-1 w-full max-w-[320px] bg-[var(--progress-track)]" aria-hidden>
            <div className={`h-full ${o.status === "cancelled" ? "bg-text-3" : "bg-[var(--progress)]"}`} style={{ width: `${pct}%` }} />
          </div>
          <p className="mt-1 text-[12px] text-text-2">
            {orderStatusText(o, now)}
            {o.status !== "active" && pct < 100 ? ` (${amountsText(o.done)} added)` : ""}
          </p>
        </div>
        {o.status === "active" && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void send({ action: "cancel", orderId: o.id }, "Order cancelled. What was added stays.")}
            className="btn-text shrink-0 !px-3"
            data-bot-cancel={o.id}
          >
            Cancel
          </button>
        )}
      </div>
    </li>
  );
}

/** The studio's Bots page (034_bot_panel.sql): order bots for a video or the channel, and see the orders. */
export function BotPanel({ panel, now }: { panel: Panel; now: number }) {
  const router = useRouter();
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const running = panel.orders.some((o) => o.status === "active");

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  // Orders deliver a little every minute: show their progress without a reload.
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => router.refresh(), REFRESH_MS);
    return () => clearInterval(t);
  }, [running, router]);

  const videos = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? panel.videos.filter((v) => v.title.toLowerCase().includes(q)) : panel.videos;
  }, [panel.videos, search]);

  const send: Send = async (body, done) => {
    if (busy) return false;
    setBusy(true);
    try {
      const res = await fetch("/api/studio/bots", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const answer = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok || answer.error) {
        setToast(botErrorMessage(answer.error ?? "failed"));
        return false;
      }
      setToast(done);
      router.refresh();
      return true;
    } catch {
      setToast(botErrorMessage("failed"));
      return false;
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6" data-bot-panel>
      <SubscribersCard panel={panel} send={send} busy={busy} />

      <section className="rounded-[2px] bg-surface shadow-[0_0_0_1px_var(--divider)]" data-bot-videos>
        <div className="flex flex-wrap items-center gap-3 border-b border-divider px-4 py-3 sm:px-6">
          <h2 className="mr-auto text-[16px] font-medium text-text">Videos</h2>
          {panel.videos.length > 5 && (
            <label className="flex h-8 min-w-0 items-center gap-2 rounded-full bg-hover px-3">
              <FilterIcon className="h-5 w-5 shrink-0 text-icon" />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by title"
                aria-label="Search by title"
                className="h-8 w-[160px] min-w-0 bg-transparent text-[13px] text-text outline-none placeholder:text-text-3"
              />
            </label>
          )}
        </div>
        {panel.videos.length === 0 ? (
          <p className="px-6 py-10 text-center text-[14px] text-text-2">
            No public or unlisted videos yet. Bots can be added once a video is processed and not private.
          </p>
        ) : videos.length === 0 ? (
          <p className="px-6 py-10 text-center text-[14px] text-text-2">No videos match that search.</p>
        ) : (
          <ul>
            {videos.map((v) => (
              <VideoRow key={v.id} v={v} open={open === v.id} onOpen={setOpen} send={send} busy={busy} />
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-[2px] bg-surface shadow-[0_0_0_1px_var(--divider)]" data-bot-orders>
        <div className="border-b border-divider px-4 py-3 sm:px-6">
          <h2 className="text-[16px] font-medium text-text">Orders</h2>
          <p className="mt-0.5 text-[12px] text-text-2">Running orders and the last 7 days. Bots add a little every minute.</p>
        </div>
        {panel.orders.length === 0 ? (
          <p className="px-6 py-10 text-center text-[14px] text-text-2">No orders yet. Nothing is added until you order it above.</p>
        ) : (
          <ul>
            {panel.orders.map((o) => (
              <OrderRow key={o.id} o={o} now={now} send={send} busy={busy} />
            ))}
          </ul>
        )}
      </section>

      <p className="text-[12px] leading-[18px] text-text-2">
        Bot accounts: {n(panel.channel.pool)} of up to {n(panel.channel.poolMax)}. Each like, dislike and subscription comes from a
        different account, and more are made when an order needs them.
      </p>

      {toast && (
        <div role="status" data-toast className="fixed bottom-6 left-6 z-[70] max-w-[calc(100vw-48px)] rounded-[2px] bg-[#323232] px-4 py-3 text-[14px] text-white shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}
