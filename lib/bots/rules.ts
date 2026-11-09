// The studio's Bots page (034_bot_panel.sql, the bots flag): what bot_panel()
// answers, the limits bot_order_add() keeps, and the words the page uses.
// No imports on purpose, so Node can load this file directly in the tests.

export type BotKind = "views" | "likes" | "dislikes" | "comments" | "subscribers";
export const BOT_KINDS: BotKind[] = ["views", "likes", "dislikes", "comments", "subscribers"];

/** The most one order may ask for. Keep in step with bot_order_add() in 034_bot_panel.sql. */
export const BOT_LIMITS: Record<BotKind, number> = {
  views: 1_000_000,
  likes: 10_000,
  dislikes: 10_000,
  comments: 1_000,
  subscribers: 10_000,
};

/** How long an order takes to deliver, in minutes. 0 is "right away" (as fast as the bots go). */
export const WINDOWS = [
  { minutes: 0, label: "Right away" },
  { minutes: 60, label: "Over 1 hour" },
  { minutes: 1440, label: "Over 24 hours" },
  { minutes: 10080, label: "Over 7 days" },
] as const;
export type WindowMinutes = (typeof WINDOWS)[number]["minutes"];

/** Likes, dislikes and comments that go with this many views, at the rates real videos get. */
export const RATES = { likes: 0.045, dislikes: 0.002, comments: 0.004 } as const;

export type BotVideo = {
  id: string;
  title: string;
  visibility: "public" | "unlisted";
  isShort: boolean;
  durationS: number | null;
  publishedAt: string | null;
  createdAt: string;
  views: number;
  likes: number;
  dislikes: number;
  comments: number;
  commentsMode: "on" | "off" | "held";
  thumbnailName: string | null;
  thumbnailUrl: string | null;
  /** Filled in by the server with a link it can show. */
  thumbnail: string | null;
  broadcastKind: "premiere" | "live" | null;
  broadcastAt: string | null;
  liveBots: boolean;
};

export type BotOrder = {
  id: string;
  videoId: string | null;
  videoTitle: string | null;
  amounts: Record<BotKind, number>;
  done: Record<BotKind, number>;
  startsAt: string;
  endsAt: string;
  status: "active" | "done" | "cancelled";
  createdAt: string;
  finishedAt: string | null;
};

export type BotPanel = {
  channel: { id: string; handle: string; name: string; subscribers: number; pool: number; poolMax: number };
  videos: BotVideo[];
  orders: BotOrder[];
};

const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const str = (v: unknown) => (typeof v === "string" ? v : v === null || v === undefined ? "" : String(v));
const strOrNull = (v: unknown) => (typeof v === "string" && v ? v : null);
const list = (v: unknown) => (Array.isArray(v) ? (v as Record<string, unknown>[]) : []);

/** bot_panel()'s jsonb as the page uses it, or null when it does not look like one. */
export function readPanel(raw: unknown): BotPanel | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const c = (r.channel ?? null) as Record<string, unknown> | null;
  if (!c || typeof c !== "object") return null;
  return {
    channel: {
      id: str(c.id),
      handle: str(c.handle),
      name: str(c.name) || str(c.handle),
      subscribers: num(c.subscribers),
      pool: num(c.pool),
      poolMax: num(c.pool_max) || 10_000,
    },
    videos: list(r.videos).map((v) => ({
      id: str(v.id),
      title: str(v.title),
      visibility: v.visibility === "unlisted" ? "unlisted" : "public",
      isShort: v.is_short === true,
      durationS: v.duration_s === null || v.duration_s === undefined ? null : num(v.duration_s),
      publishedAt: strOrNull(v.published_at),
      createdAt: str(v.created_at),
      views: num(v.views),
      likes: num(v.likes),
      dislikes: num(v.dislikes),
      comments: num(v.comments),
      commentsMode: v.comments_mode === "off" || v.comments_mode === "held" ? v.comments_mode : "on",
      thumbnailName: strOrNull(v.thumbnail_name),
      thumbnailUrl: strOrNull(v.thumbnail_url),
      thumbnail: null,
      broadcastKind: v.broadcast_kind === "premiere" || v.broadcast_kind === "live" ? v.broadcast_kind : null,
      broadcastAt: strOrNull(v.broadcast_at),
      liveBots: v.live_bots === true,
    })),
    orders: list(r.orders).map((o) => ({
      id: str(o.id),
      videoId: strOrNull(o.video_id),
      videoTitle: strOrNull(o.video_title),
      amounts: Object.fromEntries(BOT_KINDS.map((k) => [k, num(o[k])])) as Record<BotKind, number>,
      done: Object.fromEntries(BOT_KINDS.map((k) => [k, num(o[`done_${k}`])])) as Record<BotKind, number>,
      startsAt: str(o.starts_at),
      endsAt: str(o.ends_at),
      status: o.status === "done" || o.status === "cancelled" ? o.status : "active",
      createdAt: str(o.created_at),
      finishedAt: strOrNull(o.finished_at),
    })),
  };
}

export type OrderInput = Record<BotKind, number> & { videoId: string | null; overMinutes: number };

/** Whole numbers only; empty, negative or not a number is 0. */
export function amountOf(text: string | number | null | undefined): number {
  const n = Math.floor(Number(String(text ?? "").replace(/[,\s]/g, "")));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** The error code bot_order_add() would answer, checked before sending, or null. */
export function orderProblem(o: OrderInput): string | null {
  for (const k of BOT_KINDS) {
    if (!Number.isInteger(o[k]) || o[k] < 0 || o[k] > BOT_LIMITS[k]) return "bad_amount";
  }
  if (!WINDOWS.some((w) => w.minutes === o.overMinutes)) return "bad_window";
  if (!o.videoId && (o.views || o.likes || o.dislikes || o.comments)) return "not_found";
  if (BOT_KINDS.every((k) => !o[k])) return "empty_order";
  return null;
}

/** Likes, dislikes and comments that look natural for this many views. */
export function suggestFor(views: number): Pick<OrderInput, "likes" | "dislikes" | "comments"> {
  const v = Math.max(0, Math.floor(views));
  return {
    likes: Math.min(BOT_LIMITS.likes, Math.round(v * RATES.likes)),
    dislikes: Math.min(BOT_LIMITS.dislikes, Math.round(v * RATES.dislikes)),
    comments: Math.min(BOT_LIMITS.comments, Math.round(v * RATES.comments)),
  };
}

const n = (v: number) => Math.max(0, Math.floor(v)).toLocaleString("en-US");
const NAMES: Record<BotKind, [string, string]> = {
  views: ["view", "views"],
  likes: ["like", "likes"],
  dislikes: ["dislike", "dislikes"],
  comments: ["comment", "comments"],
  subscribers: ["subscriber", "subscribers"],
};

/** "1,000 views, 45 likes and 4 comments". */
export function amountsText(a: Partial<Record<BotKind, number>>): string {
  const parts = BOT_KINDS.filter((k) => (a[k] ?? 0) > 0).map((k) => `${n(a[k] ?? 0)} ${NAMES[k][a[k] === 1 ? 0 : 1]}`);
  if (parts.length <= 1) return parts[0] ?? "nothing";
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/** How much of an order is delivered, 0 to 100, counting every kind the same. */
export function orderPercent(o: Pick<BotOrder, "amounts" | "done">): number {
  const total = BOT_KINDS.reduce((s, k) => s + o.amounts[k], 0);
  if (!total) return 100;
  const done = BOT_KINDS.reduce((s, k) => s + Math.min(o.done[k], o.amounts[k]), 0);
  return Math.min(100, Math.floor((done * 100) / total));
}

/** "Right away", "Over 24 hours", or the minutes when they are not one of the choices. */
export function windowText(startsAt: string, endsAt: string): string {
  const minutes = Math.round((Date.parse(endsAt) - Date.parse(startsAt)) / 60000);
  const w = WINDOWS.find((x) => x.minutes === minutes);
  if (w) return w.label;
  return Number.isFinite(minutes) && minutes > 0 ? `Over ${minutes} minutes` : "Right away";
}

/** The status line of an order. */
export function orderStatusText(o: Pick<BotOrder, "status" | "amounts" | "done" | "endsAt">, now: number): string {
  if (o.status === "cancelled") return "Cancelled";
  if (o.status === "done") return "Delivered";
  const pct = orderPercent(o);
  const left = Date.parse(o.endsAt) - now;
  if (left > 60_000) {
    const minutes = Math.ceil(left / 60_000);
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    const when = h >= 24 ? `${Math.ceil(left / 86_400_000)} days` : h > 0 ? (m ? `${h} h ${m} min` : `${h} h`) : `${m} min`;
    return `${pct}% delivered, about ${when} to go`;
  }
  return `${pct}% delivered, finishing up`;
}

const MESSAGES: Record<string, string> = {
  not_signed_in: "Sign in to use bots.",
  bots_off: "Bots aren't on for this channel.",
  not_found: "That video is gone.",
  not_public: "Make the video public or unlisted first.",
  not_ready: "Wait until the video is processed.",
  bad_amount: "Check the numbers: up to 1,000,000 views, 10,000 likes, 10,000 dislikes, 1,000 comments and 10,000 subscribers.",
  empty_order: "Enter how many to add.",
  bad_window: "Pick how fast to add them.",
  too_many_orders: "There are 50 orders running already. Wait for some to finish or cancel one.",
  not_a_broadcast: "Bot viewers and chat are for Premieres and live broadcasts.",
  not_active: "That order already finished.",
  rate_limited: "That's a lot of changes at once. Wait a minute and try again.",
  bad_request: "Something was off with that request.",
  no_db: "The database isn't connected.",
};

export function botErrorMessage(code: string | null | undefined): string {
  return (code && MESSAGES[code]) || "Something went wrong. Try again.";
}

/** The codes the bot functions raise, passed on as they are; anything else is "failed". */
export function botErrorCode(message: string | null | undefined): string {
  const m = String(message ?? "").trim();
  return m in MESSAGES ? m : "failed";
}

export function botStatus(code: string): number {
  switch (code) {
    case "not_signed_in":
      return 401;
    case "bots_off":
      return 403;
    case "not_found":
      return 404;
    case "not_active":
    case "not_public":
    case "not_ready":
    case "too_many_orders":
      return 409;
    case "no_db":
      return 503;
    case "failed":
      return 500;
    default:
      return 400;
  }
}
