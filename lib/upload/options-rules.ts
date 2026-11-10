// Unlisted, Schedule, Drafts and Paid promotion (042_upload_options.sql): the
// parts the uploader, the studio editor and the tests share.

/** What set_upload_options() takes. publishAt is an ISO time, or null. */
export type UploadOptions = {
  visibility: "public" | "unlisted" | "private";
  publishAt: string | null;
  paidPromotion: boolean;
  draft: boolean;
};

/** A scheduled time must be at least this far ahead, and at most a year. */
export const SCHEDULE_MIN_AHEAD_MS = 5 * 60 * 1000;
export const SCHEDULE_MAX_AHEAD_MS = 365 * 24 * 60 * 60 * 1000;

const pad = (n: number) => String(n).padStart(2, "0");

/** A time as the value of <input type="datetime-local">, in the viewer's own time zone. */
export function toLocalInput(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** The value of <input type="datetime-local"> as a time, or null. */
export function fromLocalInput(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** The first time that can be picked: the next whole hour at least 5 minutes away. */
export function defaultSchedule(now = new Date()): string {
  const d = new Date(now.getTime() + SCHEDULE_MIN_AHEAD_MS);
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  return toLocalInput(d);
}

/** What is wrong with a scheduled time, or null. */
export function scheduleProblem(value: string, now = Date.now()): string | null {
  const d = fromLocalInput(value);
  if (!d) return "Pick a date and time.";
  if (d.getTime() < now + SCHEDULE_MIN_AHEAD_MS) return "Pick a time at least 5 minutes from now.";
  if (d.getTime() > now + SCHEDULE_MAX_AHEAD_MS) return "Pick a time within a year.";
  return null;
}

/** "Tue, Nov 10, 2026, 6:00 PM" for the done view, the content list and the editor. */
export function scheduleLabel(at: string | Date): string {
  const d = typeof at === "string" ? new Date(at) : at;
  return d.toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

/** set_upload_options() errors in words. */
export function optionsErrorText(code: string): string {
  switch (code) {
    case "bad_schedule":
      return "Pick a time at least 5 minutes from now and within a year.";
    case "bad_visibility":
      return "Pick public, unlisted or private.";
    case "removed":
      return "This video was removed.";
    case "in_trash":
      return "This video is in the trash.";
    case "off":
      return "Scheduling and drafts are switched off right now.";
    case "not_set_up":
      return "Scheduling and drafts aren't set up yet: run 042_upload_options.sql.";
    default:
      return "The video's settings didn't save. Try again in the studio.";
  }
}
