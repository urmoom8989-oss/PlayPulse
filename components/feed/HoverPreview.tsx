"use client";

import type Hls from "hls.js";
import { useEffect, useRef, useState } from "react";
import { HOVER_VIDEO_DELAY_MS, hoverStart, hoverVideoAllowed } from "@/lib/feed/preview";
import { useFlag } from "@/lib/store/session";
import { SpritePreview } from "./SpritePreview";

/** Safari plays HLS itself; everybody else gets hls.js (like the player). */
function preferNative(video: HTMLVideoElement): boolean {
  if (!video.canPlayType("application/vnd.apple.mpegurl")) return false;
  const ua = navigator.userAgent;
  return /safari/i.test(ua) && !/chrome|chromium|crios|android|edg/i.test(ua);
}

function allowed(): boolean {
  const conn = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  return hoverVideoAllowed({
    finePointer: window.matchMedia("(hover: hover) and (pointer: fine)").matches,
    reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    saveData: conn?.saveData === true,
  });
}

/**
 * The muted video that plays over a thumbnail while the pointer rests on the
 * card (hover_previews flag). It loads nothing until then, starts at the
 * lowest quality that fits the card, and stops and lets go of everything as
 * soon as the pointer leaves.
 */
function HoverVideo({ src, durationS }: { src: string; durationS: number | null }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const video = ref.current;
    const box = video?.closest("[data-feed-card], [data-hover-box]") ?? video?.parentElement;
    if (!video || !box || !allowed()) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let hls: Hls | null = null;
    let active = false;
    const startAt = hoverStart(durationS);

    const onPlaying = () => {
      if (active) setPlaying(true);
    };
    video.addEventListener("playing", onPlaying);

    const stop = () => {
      active = false;
      clearTimeout(timer);
      hls?.destroy();
      hls = null;
      video.pause();
      if (video.getAttribute("src")) {
        video.removeAttribute("src");
        video.load();
      }
      setPlaying(false);
    };

    const start = () => {
      stop();
      active = true;
      timer = setTimeout(async () => {
        if (!active) return;
        const url = new URL(src, window.location.href).toString();
        if (preferNative(video)) {
          video.src = url;
          video.addEventListener(
            "loadedmetadata",
            () => {
              if (startAt > 0) video.currentTime = startAt;
            },
            { once: true },
          );
        } else {
          const { default: HlsClass } = await import("hls.js");
          if (!active || !HlsClass.isSupported()) return;
          hls = new HlsClass({
            startPosition: startAt,
            startLevel: 0,
            capLevelToPlayerSize: true,
            maxBufferLength: 10,
            backBufferLength: 0,
            enableWebVTT: false,
            enableCEA708Captions: false,
          });
          hls.loadSource(url);
          hls.attachMedia(video);
        }
        video.play().catch(() => {
          // Muted autoplay can still be blocked: the sprite frames stay.
        });
      }, HOVER_VIDEO_DELAY_MS);
    };

    box.addEventListener("pointerenter", start);
    box.addEventListener("pointerleave", stop);
    return () => {
      box.removeEventListener("pointerenter", start);
      box.removeEventListener("pointerleave", stop);
      video.removeEventListener("playing", onPlaying);
      stop();
    };
  }, [src, durationS]);

  return (
    <video
      ref={ref}
      muted
      playsInline
      loop
      preload="none"
      aria-hidden
      tabIndex={-1}
      data-hover-video={playing ? "on" : "off"}
      className={`pointer-events-none absolute inset-0 h-full w-full bg-black object-cover transition-opacity duration-200 ${
        playing ? "opacity-100" : "opacity-0"
      }`}
    />
  );
}

/**
 * What plays over a card's thumbnail on hover: the sprite's frames (always,
 * when the video has a sprite) and, with the hover_previews flag, the video.
 */
export function HoverPreview({ vtt, src, durationS }: { vtt: string | null; src: string | null; durationS: number | null }) {
  const video = useFlag("hover_previews");
  return (
    <>
      {vtt && <SpritePreview vtt={vtt} />}
      {video && src && <HoverVideo src={src} durationS={durationS} />}
    </>
  );
}
