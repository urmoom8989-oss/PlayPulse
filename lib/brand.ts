/**
 * The PlayPulse marks, in one place so the header, the favicon, the press kit
 * and the maintenance page all draw the same thing.
 *
 * The mark is one teal line: a heartbeat that runs into a play triangle and
 * out the other side ("play" and "pulse"). The Snips mark (short vertical
 * videos) is a single drop with a small wave. Both are our own drawings: no
 * red, no rectangle.
 */

/** Both marks are drawn on a 24 by 24 grid. */
export const MARK_VIEWBOX = "0 0 24 24";

/** The mark: the heartbeat, the play triangle and the line out. Stroked, never filled. */
export const MARK_LINE = "M1.6 12h3.3l1.7-3.6 2.1 7.2 1.6-3.6M10.3 6.3v11.4l9-5.7zM19.3 12h3.1";

/** How the mark is stroked, on the 24 grid. The tab icon is tiny, so it gets a heavier line. */
export const MARK_STROKE = 2;
export const FAVICON_STROKE = 2.8;

/** The Snips drop. */
export const SNIPS_DROP = "M12 1.8c3.9 5.2 7 8.8 7 13.2a7 7 0 0 1-14 0c0-4.4 3.1-8 7-13.2z";

/** The wave inside the Snips drop. */
export const SNIPS_WAVE = "M8.6 15.4c1.1-1.5 2.3-1.5 3.4 0s2.3 1.5 3.4 0";

/** Brand colors, also set as --mark and --logo-word in app/globals.css. */
export const BRAND = {
  mark: "#0f766e",
  markDark: "#2dd4bf",
  word: "#0f766e",
  wordDark: "#5eead4",
} as const;

/** The mark's path element, in one color. */
export function markPath(color: string = BRAND.mark, stroke: number = MARK_STROKE): string {
  return `<path d="${MARK_LINE}" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round"/>`;
}

/** The mark as a standalone SVG string (press kit, favicon, maintenance page). */
export function markSvg(size = 24, color: string = BRAND.mark, stroke: number = MARK_STROKE): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="${MARK_VIEWBOX}">` +
    markPath(color, stroke) +
    `</svg>`
  );
}

/** The mark and the two tone PlayPulse wordmark. */
export function logoSvg(): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="560" height="120" viewBox="0 0 140 30">` +
    `<g transform="translate(0 1.5) scale(1.12)">${markPath()}</g>` +
    `<text x="30" y="21" font-family="Roboto, Arial, sans-serif" font-size="17" font-weight="700" letter-spacing="-0.4">` +
    `<tspan fill="${BRAND.word}">Play</tspan><tspan fill="#030303">Pulse</tspan></text>` +
    `</svg>`
  );
}
