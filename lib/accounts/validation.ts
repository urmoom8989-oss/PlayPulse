// Account rules shared by the forms and the tests (`node --test tests/`).
// Keep in step with public.username_is_valid() in
// supabase/migrations/021_open_uploads_usernames.sql.
// No imports on purpose, so Node can load this file directly.

/** Usernames are 3 to 24 characters, counted as Unicode characters (not UTF-16 units). */
export const USERNAME_MIN = 3;
export const USERNAME_MAX = 24;
/**
 * Emoji, as code point ranges: everything Unicode shows as an emoji by default
 * (Emoji_Presentation), the pictograph blocks from U+1F000 up (which also
 * covers emoji added later), and the pieces emoji are built from (the zero
 * width joiner, the emoji style selector, the keycap mark and tag characters).
 * Text symbols like ★ ♥ © ™ stay allowed unless they are turned into emoji.
 * The database has the same list in username_is_valid(); a test keeps them equal.
 */
export const EMOJI_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x200d, 0x200d], [0x20e3, 0x20e3], [0x231a, 0x231b], [0x23e9, 0x23ec], [0x23f0, 0x23f0],
  [0x23f3, 0x23f3], [0x25fd, 0x25fe], [0x2614, 0x2615], [0x2648, 0x2653], [0x267f, 0x267f],
  [0x2693, 0x2693], [0x26a1, 0x26a1], [0x26aa, 0x26ab], [0x26bd, 0x26be], [0x26c4, 0x26c5],
  [0x26ce, 0x26ce], [0x26d4, 0x26d4], [0x26ea, 0x26ea], [0x26f2, 0x26f3], [0x26f5, 0x26f5],
  [0x26fa, 0x26fa], [0x26fd, 0x26fd], [0x2705, 0x2705], [0x270a, 0x270b], [0x2728, 0x2728],
  [0x274c, 0x274c], [0x274e, 0x274e], [0x2753, 0x2755], [0x2757, 0x2757], [0x2795, 0x2797],
  [0x27b0, 0x27b0], [0x27bf, 0x27bf], [0x2b1b, 0x2b1c], [0x2b50, 0x2b50], [0x2b55, 0x2b55],
  [0xfe0f, 0xfe0f], [0x1f000, 0x1faff], [0x1fc00, 0x1fffd], [0xe0020, 0xe007f],
];
/**
 * Characters nobody can see, which would let two usernames look the same:
 * control characters, zero width spaces and marks, and text direction overrides.
 * Kept in step with the database like EMOJI_RANGES.
 */
export const INVISIBLE_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x1, 0x1f], [0x7f, 0x9f], [0x200b, 0x200f], [0x202a, 0x202e], [0x2060, 0x2064],
  [0x2066, 0x2069], [0xfeff, 0xfeff],
];

function rangeClass(ranges: ReadonlyArray<readonly [number, number]>): RegExp {
  const hex = (n: number) => `\\u{${n.toString(16)}}`;
  return new RegExp(`[${ranges.map(([a, b]) => (a === b ? hex(a) : `${hex(a)}-${hex(b)}`)).join("")}]`, "u");
}
const EMOJI = rangeClass(EMOJI_RANGES);
const INVISIBLE = rangeClass(INVISIBLE_RANGES);

export const MIN_AGE = 13;
export const DISPLAY_NAME_MAX = 50;
export const BIO_MAX = 1000;
export const PASSWORD_MIN = 8;

export const RESERVED_USERNAMES = new Set([
  "admin", "administrator", "api", "auth", "channel", "flags", "help", "history",
  "library", "login", "logout", "me", "moderator", "null", "root", "settings",
  "signup", "sloptube", "staff", "subscriptions", "support", "system", "trending",
  "undefined", "upload", "watch", "welcome",
]);

/**
 * Usernames keep the case and characters people type. Trims spaces around the
 * name and a leading "@". Two names that differ only in case are the same
 * name for "is it taken" (the database compares them lower case).
 */
export function normalizeUsername(input: string): string {
  return input.trim().replace(/^@/, "").trim();
}

/** Returns a short reason, or null when the username is fine. Expects a normalized name. */
export function usernameProblem(name: string): string | null {
  const length = [...name].length;
  if (length < USERNAME_MIN) return `Use at least ${USERNAME_MIN} characters.`;
  if (length > USERNAME_MAX) return `Use at most ${USERNAME_MAX} characters.`;
  if (EMOJI.test(name)) return "Usernames can't have emoji.";
  if (INVISIBLE.test(name)) return "Usernames can't have invisible characters.";
  if (RESERVED_USERNAMES.has(name.toLowerCase())) return "That username is reserved.";
  return null;
}

export type CalendarDate = { year: number; month: number; day: number };

/** Parses "YYYY-MM-DD" into a real calendar date, or null. */
export function parseDate(value: string): CalendarDate | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) {
    return null;
  }
  return { year, month, day };
}

export function formatDate({ year, month, day }: CalendarDate): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Today in the person's own calendar (local time). */
export function today(now: Date = new Date()): CalendarDate {
  return { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() };
}

/** Age in whole years on the given day. Someone born on 29 Feb turns a year older on 1 Mar. */
export function ageOn(birth: CalendarDate, on: CalendarDate): number {
  let age = on.year - birth.year;
  if (on.month < birth.month || (on.month === birth.month && on.day < birth.day)) age--;
  return age;
}

export type BirthdateProblem = "birthdate_required" | "invalid_birthdate" | "too_young";

/** Checks a "YYYY-MM-DD" birthdate against the 13+ rule. Null means fine. */
export function birthdateProblem(value: string, on: CalendarDate = today()): BirthdateProblem | null {
  if (!value.trim()) return "birthdate_required";
  const birth = parseDate(value);
  if (!birth) return "invalid_birthdate";
  if (birth.year < 1900 || formatDate(birth) > formatDate(on)) return "invalid_birthdate";
  if (ageOn(birth, on) < MIN_AGE) return "too_young";
  return null;
}

export const AVATAR_TYPES = ["image/png", "image/jpeg", "image/webp"];
export const AVATAR_MAX_BYTES = 2 * 1024 * 1024;
export const AVATAR_SIZE_PX = 256;

/** Checks a picked file before it is resized. Null means fine. */
export function avatarFileProblem(file: { type: string; size: number }): string | null {
  if (!AVATAR_TYPES.includes(file.type)) return "Use a PNG, JPG or WebP image.";
  if (file.size > AVATAR_MAX_BYTES) return "The image must be 2 MB or smaller.";
  return null;
}

/** Friendly text for the error codes raised by the database functions and auth. */
export function accountErrorText(code: string): string {
  const known: Record<string, string> = {
    not_signed_in: "Your session ended. Sign in again.",
    invalid_username: "That username cannot be used. Use 3 to 24 characters, without emoji.",
    username_taken: "That username is taken. Try another.",
    birthdate_required: "Enter your birthday.",
    invalid_birthdate: "Enter a real birthday.",
    too_young: `You must be ${MIN_AGE} or older to use PlayPulse.`,
    already_complete: "Your account is already set up.",
  };
  for (const key of Object.keys(known)) {
    if (code.includes(key)) return known[key];
  }
  if (/invalid login credentials/i.test(code)) return "Wrong email or password.";
  if (/email not confirmed/i.test(code)) return "Confirm your email first. Check your inbox for the link.";
  if (/user already registered/i.test(code)) return "There is already an account with that email. Sign in instead.";
  if (/database error saving new user/i.test(code)) return "Could not create the account. Check your birthday and try again.";
  return code || "Something went wrong. Try again.";
}
