/** How far (px) the finger pulls before letting go refreshes, and the most the arrow moves. */
export const PULL_TRIGGER = 72;
export const PULL_MAX = 120;

/** The arrow follows the finger, slowing down near the end, up to PULL_MAX: about 110 px of finger refreshes. */
export function pullDistance(dy: number): number {
  if (dy <= 0) return 0;
  return Math.round(PULL_MAX * (1 - Math.exp(-dy / PULL_MAX)));
}

/** Pages that scroll up and down themselves (the Snips feed) keep their own swipes. */
export function pullAllowed(path: string | null): boolean {
  return !path || !/^\/shorts(\/|$)/.test(path);
}
