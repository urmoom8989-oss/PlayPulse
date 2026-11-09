// Live chat and card badges as the browser sees them.
// Only relative imports, so Node can load this file directly.

import { isBroadcastKind, type BroadcastKind, type BroadcastState } from "./state.ts";

export type ChatMessage = {
  id: number;
  /** Seconds into the broadcast when it was sent (negative in the waiting room). */
  offsetS: number;
  createdAt: string;
  body: string;
  author: { name: string; handle: string | null; avatarUrl: string | null };
  /** Sent by the channel's owner (shown with a badge). */
  isOwner: boolean;
  isMine: boolean;
};

export type ChatRow = {
  id: number | string;
  offset_s: number | string;
  created_at: string;
  body: string;
  author_name: string | null;
  author_handle: string | null;
  author_avatar_url: string | null;
  is_owner: boolean | null;
  is_mine: boolean | null;
};

export function rowToChatMessage(r: ChatRow): ChatMessage {
  return {
    id: Number(r.id),
    offsetS: Number(r.offset_s) || 0,
    createdAt: r.created_at,
    body: r.body,
    author: { name: r.author_name || "Someone", handle: r.author_handle, avatarUrl: r.author_avatar_url },
    isOwner: r.is_owner === true,
    isMine: r.is_mine === true,
  };
}

/** A broadcast as a card shows it. */
export type CardBroadcast = { kind: BroadcastKind; at: string; state: BroadcastState; viewers: number };

export function cardBroadcastFromRow(row: { kind: string; at: string; state: string; viewers: number | string }): CardBroadcast | null {
  if (!isBroadcastKind(row.kind) || !row.at) return null;
  const state = row.state === "upcoming" || row.state === "live" || row.state === "ended" ? row.state : null;
  if (!state) return null;
  return { kind: row.kind, at: row.at, state, viewers: Number(row.viewers) || 0 };
}

/** What live chat says when posting fails. */
export const CHAT_ERRORS: Record<string, string> = {
  not_signed_in: "Sign in to chat.",
  chat_off: "Chat isn't on yet.",
  chat_closed: "Chat is closed. This broadcast has ended.",
  blocked: "You can't chat right now.",
  bad_length: "Messages are 1 to 200 characters.",
  no_links: "Links aren't allowed in chat.",
  blocked_word: "That message has a word this channel doesn't allow.",
  slow_down: "Slow down: one message every 2 seconds.",
  not_found: "This chat isn't there anymore.",
};

export function chatError(code: string | null | undefined): string {
  return (code && CHAT_ERRORS[code]) || "Couldn't send that. Try again.";
}
