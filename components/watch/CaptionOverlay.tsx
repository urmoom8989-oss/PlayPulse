"use client";

import { SettingsIcon } from "@/components/icons";
import { captionCss, type CaptionCue, type CaptionStyle } from "@/lib/watch/captions";

type Props = {
  /** The cues on screen now. */
  cues: CaptionCue[];
  /** Right after captions go on: the track's name and where the settings are, until the first words. */
  hint: string | null;
  style: CaptionStyle;
  /** The player's height in pixels: the caption size follows it. */
  playerHeight: number;
  /** The controls are showing, so the words sit above them. */
  raised: boolean;
};

/**
 * The captions over the video (player extras): every line in its own box,
 * centered near the bottom, in the viewer's font, colors and size.
 */
export function CaptionOverlay({ cues, hint, style, playerHeight, raised }: Props) {
  const lines = cues.flatMap((c) => c.text.split("\n").map((text, i) => ({ key: `${c.start}-${i}`, text })));
  if (lines.length === 0 && !hint) return null;
  const css = captionCss(style, playerHeight);
  const bottom = raised ? 60 : Math.max(8, Math.round(playerHeight * 0.04));
  return (
    <div
      data-captions
      aria-live="off"
      className="pointer-events-none absolute inset-x-0 z-[5] flex flex-col items-center px-[5%] text-center leading-[1.3] transition-[bottom] duration-200"
      style={{ bottom }}
    >
      {lines.length > 0
        ? lines.map((l) => (
            <div key={l.key} data-caption-line>
              <span className="whitespace-pre-wrap px-[0.25em] py-[0.05em] [box-decoration-break:clone]" style={css}>
                {l.text}
              </span>
            </div>
          ))
        : hint && (
            <div data-caption-hint>
              <div>
                <span className="px-[0.25em] py-[0.05em]" style={css}>
                  {hint}
                </span>
              </div>
              <div>
                <span className="inline-flex items-center gap-[0.25em] px-[0.25em] py-[0.05em]" style={css}>
                  Click <SettingsIcon className="h-[1em] w-[1em]" /> for settings
                </span>
              </div>
            </div>
          )}
    </div>
  );
}
