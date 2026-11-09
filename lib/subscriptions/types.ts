// What the subscription routes hand to the browser. Everything here is about
// the signed in person's own subscriptions, or public channel data.
// Only relative imports, so Node can load this file directly.

import { levelOf, type NotifyLevel } from "./rules.ts";

/** A channel in the guide's Subscriptions list. */
export type GuideChannel = {
  id: string;
  handle: string;
  name: string;
  avatarUrl: string | null;
  notify: boolean;
  /** All, Personalized or None (the bell_options flag); "all" or "none" from older rows. */
  level: NotifyLevel;
  /** The newest public and ready upload, or null. */
  latestUploadAt: string | null;
  /** Placeholder for a later feature: always 0 for now. */
  unseen: number;
};

/** A row from my_subscriptions(). */
export type MySubscriptionRow = {
  channel_id: string;
  handle: string;
  name: string;
  avatar_url: string | null;
  notify: boolean;
  subscribed_at: string;
  latest_upload_at: string | null;
  unseen: number | null;
  /** From 027 on. */
  notify_level?: string | null;
};

/** What subscribe(), unsubscribe(), set_notify() and set_notify_level() answer, and the POST route. */
export type SubResult = { subscribed: boolean; notify: boolean; count: number; level?: NotifyLevel };

export function rowToGuideChannel(r: MySubscriptionRow): GuideChannel {
  return {
    id: r.channel_id,
    handle: r.handle,
    name: r.name,
    avatarUrl: r.avatar_url,
    notify: r.notify === true,
    level: levelOf(r.notify_level, r.notify === true),
    latestUploadAt: r.latest_upload_at,
    unseen: Number(r.unseen) || 0,
  };
}
