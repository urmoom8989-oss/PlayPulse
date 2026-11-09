// The player's keyboard shortcuts, as a pure function from a key press to an
// action, so the tests can check the whole map. No imports.

export type PlayerAction =
  | { type: "toggle-play" }
  | { type: "seek-by"; seconds: number }
  | { type: "seek-percent"; percent: number }
  | { type: "volume-by"; delta: number }
  | { type: "toggle-mute" }
  | { type: "fullscreen" }
  | { type: "theater" }
  | { type: "pip" }
  | { type: "captions" }
  | { type: "caption-size"; step: 1 | -1 }
  | { type: "speed-step"; step: 1 | -1 }
  | { type: "frame-step"; step: 1 | -1 }
  | { type: "seek-edge"; edge: "start" | "end" };

export type KeyInput = {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  /** The tag of the element the key went to, like "INPUT". */
  targetTag?: string;
  /** True when that element is contenteditable. */
  targetEditable?: boolean;
};

/** A focused button or link keeps space and Enter for itself (feature 15). */
function isControl(e: KeyInput): boolean {
  const tag = (e.targetTag ?? "").toUpperCase();
  return tag === "BUTTON" || tag === "A" || tag === "SUMMARY";
}

/** Typing in a field never drives the player. */
function isTyping(e: KeyInput): boolean {
  const tag = (e.targetTag ?? "").toUpperCase();
  return Boolean(e.targetEditable) || tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

/**
 * The 2019 YouTube keys:
 *   space, k        play or pause
 *   j, l            back or forward 10 seconds
 *   left, right     back or forward 5 seconds
 *   up, down        volume up or down 5%
 *   m               mute
 *   f               fullscreen
 *   t               theater mode
 *   i               picture in picture
 *   c               subtitles and closed captions on or off
 *   + and -         captions bigger or smaller
 *   0 to 9          jump to 0% to 90%
 * With `more` (the more_shortcuts flag), the rest of the 2020 keys:
 *   < and >         slower or faster (Shift+, and Shift+.)
 *   , and .         one frame back or forward, while paused
 *   Home, End       the start or the end of the video
 * Returns null for any other key, and when a modifier is held (so browser
 * shortcuts like Ctrl+L keep working) or the person is typing. Space on a
 * focused button or link presses that button, as everywhere else.
 */
export function keyAction(e: KeyInput, more: boolean = false): PlayerAction | null {
  if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e)) return null;
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if ((key === " " || key === "Spacebar") && isControl(e)) return null;
  switch (key) {
    case " ":
    case "Spacebar":
    case "k":
      return { type: "toggle-play" };
    case "j":
      return { type: "seek-by", seconds: -10 };
    case "l":
      return { type: "seek-by", seconds: 10 };
    case "ArrowLeft":
      return { type: "seek-by", seconds: -5 };
    case "ArrowRight":
      return { type: "seek-by", seconds: 5 };
    case "ArrowUp":
      return { type: "volume-by", delta: 0.05 };
    case "ArrowDown":
      return { type: "volume-by", delta: -0.05 };
    case "m":
      return { type: "toggle-mute" };
    case "f":
      return { type: "fullscreen" };
    case "t":
      return { type: "theater" };
    case "i":
      return { type: "pip" };
    case "c":
      return { type: "captions" };
    case "+":
    case "=":
      return { type: "caption-size", step: 1 };
    case "-":
    case "_":
      return { type: "caption-size", step: -1 };
  }
  if (/^[0-9]$/.test(key)) return { type: "seek-percent", percent: Number(key) * 10 };
  if (!more) return null;
  switch (key) {
    case "<":
      return { type: "speed-step", step: -1 };
    case ">":
      return { type: "speed-step", step: 1 };
    case ",":
      return { type: "frame-step", step: -1 };
    case ".":
      return { type: "frame-step", step: 1 };
    case "Home":
      return { type: "seek-edge", edge: "start" };
    case "End":
      return { type: "seek-edge", edge: "end" };
  }
  return null;
}

/** One frame, for , and . (the 2020 player stepped by 1/30 of a second). */
export const FRAME_S = 1 / 30;

/**
 * The next speed up or down the list (the gear menu's speeds), or the same
 * speed at either end. A speed that is not on the list goes to its neighbour.
 */
export function stepSpeed(rate: number, step: 1 | -1, speeds: readonly number[]): number {
  if (speeds.length === 0) return rate;
  if (step > 0) return speeds.find((s) => s > rate + 1e-9) ?? speeds[speeds.length - 1];
  for (let i = speeds.length - 1; i >= 0; i--) if (speeds[i] < rate - 1e-9) return speeds[i];
  return speeds[0];
}

/** Where a seek lands: never before 0, never past the end. */
export function clampTime(t: number, duration: number): number {
  if (!Number.isFinite(t) || t < 0) return 0;
  if (Number.isFinite(duration) && duration > 0) return Math.min(t, duration);
  return t;
}

/** Volume after a step, kept between 0 and 1 and rounded to whole percents. */
export function stepVolume(volume: number, delta: number): number {
  return Math.round(Math.min(1, Math.max(0, volume + delta)) * 100) / 100;
}
