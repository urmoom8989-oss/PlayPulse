// The play/pause button's two shapes (components/watch/PlayPauseIcon.tsx),
// which fold into each other like the 2020 player. Both have the same eight
// points in a 36 x 36 box: pause is two bars; play is the triangle cut down
// the middle into two halves, so each bar folds into one half. Only relative
// imports, so Node can load it directly.

const PAUSE = [
  [12, 26], [16, 26], [16, 10], [12, 10],
  [20, 26], [24, 26], [24, 10], [20, 10],
];
const PLAY = [
  [12, 26], [18.5, 22], [18.5, 14], [12, 10],
  [18.5, 22], [25, 18], [25, 18], [18.5, 14],
];

/** How long a whole fold takes, in ms. */
export const PLAY_MORPH_MS = 200;

const r2 = (n: number) => Math.round(n * 100) / 100;

/** The path at `p`: 0 is pause, 1 is play, in between a fold. */
export function playPauseShape(p: number): string {
  const k = Number.isFinite(p) ? Math.min(1, Math.max(0, p)) : 0;
  const pts = PAUSE.map(([x, y], i) => [r2(x + (PLAY[i][0] - x) * k), r2(y + (PLAY[i][1] - y) * k)]);
  const half = (from: number) =>
    `M${pts[from][0]},${pts[from][1]} ${pts[from + 1][0]},${pts[from + 1][1]} ${pts[from + 2][0]},${pts[from + 2][1]} ${pts[from + 3][0]},${pts[from + 3][1]}z`;
  return `${half(0)} ${half(4)}`;
}

/** Slow in, slow out (cubic), for t from 0 to 1. */
export function morphEase(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}
