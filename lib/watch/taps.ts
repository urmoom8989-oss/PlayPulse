// Double tap to skip on phones (player extras): the left half goes back,
// the right half forward, 10 seconds for each tap after the first.
// No imports on purpose, so Node can load this file directly in the tests.

/** A second tap within this long, on the same half, is a double tap. */
export const DOUBLE_TAP_MS = 300;
/** Seconds each tap after the first skips. */
export const TAP_SKIP_S = 10;
/**
 * Once skipping, a tap this long after the last one still adds 10 seconds:
 * the note stays up for this long, and while it shows taps keep skipping.
 */
export const TAP_CONTINUE_MS = DOUBLE_TAP_MS + 500;

export type TapSide = "back" | "forward";
export type TapState = { at: number; side: TapSide; count: number };

/** Which half of the video a tap at `x` (from the left edge) landed on. */
export function tapSide(x: number, width: number): TapSide {
  return width > 0 && x >= width / 2 ? "forward" : "back";
}

/**
 * One tap at time `at` (milliseconds). A tap soon after the last one on the
 * same half adds to it and skips 10 seconds (within `windowMs` for the
 * second tap, within TAP_CONTINUE_MS once skipping); anything else starts
 * over and may still turn out to be a single tap (`skip` is 0).
 */
export function nextTap(
  prev: TapState | null,
  at: number,
  side: TapSide,
  windowMs: number = DOUBLE_TAP_MS,
): { state: TapState; skip: number } {
  const limit = prev && prev.count >= 2 ? Math.max(windowMs, TAP_CONTINUE_MS) : windowMs;
  if (prev && prev.side === side && at - prev.at >= 0 && at - prev.at <= limit) {
    return { state: { at, side, count: prev.count + 1 }, skip: side === "back" ? -TAP_SKIP_S : TAP_SKIP_S };
  }
  return { state: { at, side, count: 1 }, skip: 0 };
}

/** What the note on the video says after `count` taps: 10 seconds after two taps, 20 after three. */
export function tapTotal(count: number): number {
  return Math.max(0, count - 1) * TAP_SKIP_S;
}
