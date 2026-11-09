"use client";

import { useT } from "@/lib/i18n/client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Avatar } from "@/components/Avatar";
import { CloseIcon, SendIcon } from "@/components/icons";
import { useLive } from "@/lib/store/live";
import { useSession } from "@/lib/store/session";
import { useWatch } from "@/lib/store/watch";
import { broadcastState, CHAT_KEEP, CHAT_POLL_MS, PRESENCE_MS, replayWindow, type Broadcast } from "@/lib/live/state";
import { chatError, type ChatMessage } from "@/lib/live/types";

function Message({ m, canDelete, onDelete }: { m: ChatMessage; canDelete: boolean; onDelete: (id: number) => void }) {
  return (
    <li className="group flex items-start gap-4 px-6 py-1 text-[13px] leading-[18px]" data-chat-message={m.id}>
      <span className="mt-0.5 shrink-0">
        <Avatar name={m.author.name} url={m.author.avatarUrl} size={24} />
      </span>
      <p className="min-w-0 flex-1 break-words py-0.5">
        <span
          className={`mr-2 font-medium ${m.isOwner ? "rounded-[2px] bg-[#ffd600] px-1 text-[#111111]" : "text-text-2"}`}
          data-chat-owner={m.isOwner ? "1" : undefined}
        >
          {m.author.name}
        </span>
        <span className="text-text">{m.body}</span>
      </p>
      {canDelete && (
        <button
          type="button"
          aria-label="Remove message"
          onClick={() => onDelete(m.id)}
          className="invisible grid h-6 w-6 shrink-0 place-items-center rounded-full text-icon hover:bg-hover group-hover:visible focus:visible"
        >
          <CloseIcon className="h-4 w-4" />
        </button>
      )}
    </li>
  );
}

/**
 * Live chat beside the player, 2020 style. While a Premiere or live broadcast
 * is coming or on, it polls for new messages, lets signed in people post, and
 * pings presence (the "watching now" count). Once the broadcast has ended it
 * is Chat replay: the messages appear as the video reaches the moment they
 * were sent. The channel's owner can remove any message, authors their own.
 */
export function LiveChat({
  videoId,
  broadcast,
  durationS,
  isOwner,
}: {
  videoId: string;
  broadcast: Broadcast;
  durationS: number | null;
  /** The viewer owns the channel. */
  isOwner: boolean;
}) {
  const t = useT();
  const user = useSession((s) => s.user);
  const setViewers = useLive((s) => s.setViewers);
  const currentTime = useWatch((s) => s.currentTime);
  const [state, setState] = useState(broadcast.state);
  const [open, setOpen] = useState(broadcast.state !== "ended");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [replay, setReplay] = useState<{ from: number; list: ChatMessage[] } | null>(null);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const listRef = useRef<HTMLUListElement>(null);
  const lastId = useRef<number | null>(null);
  const live = state !== "ended";

  // Where the broadcast is, checked every few seconds (it can end while the page is open).
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => setState(broadcastState(broadcast.at, durationS, Date.now())), 5000);
    return () => clearInterval(t);
  }, [live, broadcast.at, durationS]);

  // New messages while it is on.
  const poll = useCallback(async () => {
    const after = lastId.current;
    const res = await fetch(`/api/live/chat?v=${videoId}${after !== null ? `&after=${after}` : ""}`, { cache: "no-store" }).catch(() => null);
    if (!res?.ok) return;
    const { messages: fresh } = (await res.json()) as { messages: ChatMessage[] };
    if (!fresh.length) return;
    lastId.current = fresh[fresh.length - 1].id;
    setMessages((old) => {
      const seen = new Set(old.map((m) => m.id));
      return [...old, ...fresh.filter((m) => !seen.has(m.id))].slice(-CHAT_KEEP);
    });
  }, [videoId]);

  useEffect(() => {
    if (!live || !open) return;
    const first = setTimeout(() => void poll(), 0);
    const t = setInterval(() => void poll(), CHAT_POLL_MS);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [live, open, poll]);

  // Presence: counts this viewer, and tells the title line how many are here.
  useEffect(() => {
    if (!live) return;
    const ping = async () => {
      const res = await fetch("/api/live/presence", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ videoId }),
      }).catch(() => null);
      if (!res?.ok) return;
      const { viewers } = (await res.json()) as { viewers: number };
      setViewers(videoId, viewers);
    };
    const first = setTimeout(() => void ping(), 0);
    const t = setInterval(() => void ping(), PRESENCE_MS);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [live, videoId, setViewers]);

  // Chat replay: one minute of the broadcast at a time, around where the video is.
  const span = replayWindow(currentTime);
  useEffect(() => {
    if (live || !open || replay?.from === span.from) return;
    let gone = false;
    void fetch(`/api/live/chat?v=${videoId}&from=${span.from}&to=${span.to}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { messages: [] }))
      .then(({ messages: list }: { messages: ChatMessage[] }) => {
        if (!gone) setReplay({ from: span.from, list });
      })
      .catch(() => {});
    return () => {
      gone = true;
    };
  }, [live, open, replay?.from, span.from, span.to, videoId]);

  const shown = live ? messages : (replay?.list ?? []).filter((m) => m.offsetS <= currentTime);

  // Stick to the bottom as messages come in.
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [shown.length]);

  async function send() {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    setError(null);
    const res = await fetch("/api/live/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ videoId, body }),
    }).catch(() => null);
    const json = (await res?.json().catch(() => null)) as { error?: string } | null;
    setSending(false);
    if (!res?.ok) return setError(t(chatError(json?.error)));
    setText("");
    void poll();
  }

  async function remove(id: number) {
    const res = await fetch("/api/live/chat", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id }),
    }).catch(() => null);
    if (res?.ok) {
      setMessages((old) => old.filter((m) => m.id !== id));
      setReplay((r) => (r ? { ...r, list: r.list.filter((m) => m.id !== id) } : r));
    }
  }

  const title = live ? t("Live chat") : t("Chat replay");
  if (!open) {
    return (
      <div className="mb-4 border border-divider bg-surface" data-live-chat="closed">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="h-10 w-full text-[14px] font-medium uppercase tracking-[0.007px] text-text-2 hover:bg-hover"
        >
          {live ? t("Show chat") : t("Show chat replay")}
        </button>
      </div>
    );
  }

  return (
    <section className="mb-4 flex h-[480px] flex-col border border-divider bg-surface" data-live-chat={live ? "live" : "replay"} aria-label={title}>
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-divider px-4">
        <h2 className="text-[16px] font-normal text-text">{title}</h2>
        {!live && <span className="text-[12px] text-text-2">{t("Messages show as the video plays")}</span>}
      </header>
      <ul ref={listRef} className="min-h-0 flex-1 overflow-y-auto py-2" aria-live="polite">
        {shown.length === 0 && (
          <li className="px-6 py-4 text-center text-[13px] text-text-2">
            {live ? (state === "upcoming" ? t("Say hi while you wait.") : t("No messages yet.")) : t("No messages at this point.")}
          </li>
        )}
        {shown.map((m) => (
          <Message key={m.id} m={m} canDelete={isOwner || m.isMine} onDelete={(id) => void remove(id)} />
        ))}
      </ul>
      {live && (
        <footer className="shrink-0 border-t border-divider px-6 py-3">
          {user ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void send();
              }}
            >
              <div className="flex items-center gap-4">
                <Avatar name={user.displayName} url={user.avatarUrl} size={24} />
                <span className="text-[13px] font-medium text-text-2">{user.displayName}</span>
              </div>
              <div className="mt-2 flex items-end gap-2 pl-10">
                <input
                  value={text}
                  onChange={(e) => setText(e.target.value.slice(0, 200))}
                  placeholder={t("Say something...")}
                  aria-label={t("Chat message")}
                  maxLength={200}
                  data-chat-input
                  className="min-w-0 flex-1 border-b border-[var(--input-border)] bg-transparent pb-1 text-[14px] text-text outline-none focus:border-b-2 focus:border-[var(--focus)]"
                />
                <span className="pb-1 text-[11px] text-text-3">{text.length}/200</span>
                <button
                  type="submit"
                  aria-label={t("Send")}
                  disabled={!text.trim() || sending}
                  data-chat-send
                  className="grid h-8 w-8 place-items-center rounded-full text-icon disabled:opacity-40"
                >
                  <SendIcon className="h-5 w-5" />
                </button>
              </div>
              {error && (
                <p role="alert" className="mt-1 pl-10 text-[12px] text-[var(--error)]">
                  {error}
                </p>
              )}
            </form>
          ) : (
            <p className="text-center text-[13px] text-text-2">
              <Link href={`/login?next=${encodeURIComponent(`/watch?v=${videoId}`)}`} className="font-medium uppercase text-link">
                {t("Sign in")}
              </Link>{" "}
              {t("to chat")}
            </p>
          )}
        </footer>
      )}
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="h-10 shrink-0 border-t border-divider text-[14px] font-medium uppercase tracking-[0.007px] text-text-2 hover:bg-hover"
      >
        {live ? t("Hide chat") : t("Hide chat replay")}
      </button>
    </section>
  );
}
