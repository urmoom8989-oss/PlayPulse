// What the player shows when a video ends (player extras): the autoplay
// countdown to the next video, or, with autoplay off, a wall of videos.
// No imports on purpose, so Node can load this file directly in the tests.

/** Seconds the "Up next" countdown runs before the next video starts. */
export const AUTOPLAY_COUNTDOWN_S = 8;
/** The end screen is a 3 by 3 wall. */
export const END_SCREEN_COUNT = 9;

type WithId = { id: string };

/** The videos for the end screen: Up next without the video that just ended, at most nine. */
export function endScreenVideos<T extends WithId>(upNext: readonly T[], currentId: string): T[] {
  return upNext.filter((v) => v.id !== currentId).slice(0, END_SCREEN_COUNT);
}

/** The video autoplay goes to: the first one in Up next that is not this one. */
export function nextVideo<T extends WithId>(upNext: readonly T[], currentId: string): T | null {
  return upNext.find((v) => v.id !== currentId) ?? null;
}

/**
 * What the player shows at the end: the countdown when autoplay is on and
 * there is a next video, the wall when there are videos to show, or nothing
 * (the replay button).
 */
export function endChoice(autoplay: boolean, hasNext: boolean, wallCount: number): "countdown" | "wall" | null {
  if (autoplay && hasNext) return "countdown";
  return wallCount > 0 ? "wall" : null;
}

/** Seconds left on the countdown, whole and never below 0. */
export function secondsLeft(startedAtMs: number, nowMs: number, totalS: number = AUTOPLAY_COUNTDOWN_S): number {
  return Math.max(0, Math.ceil(totalS - Math.max(0, nowMs - startedAtMs) / 1000));
}
