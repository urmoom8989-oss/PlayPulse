"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  captionPrefsText,
  DEFAULT_CAPTION_PREFS,
  parseCaptionPrefs,
  parseCaptionVtt,
  parseSubtitleTracks,
  pickTrack,
  subtitleSegments,
  type CaptionCue,
  type CaptionPrefs,
  type CaptionStyle,
  type CaptionTrack,
} from "@/lib/watch/captions";
import { loadCaptions, saveCaptions } from "@/lib/watch/prefs";

/** A subtitle playlist with more files than this is cut off there. Ours have one. */
const MAX_FILES = 50;

async function fetchText(url: string): Promise<string> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status}`);
  return r.text();
}

/**
 * The captions of one video (player extras): the tracks its master playlist
 * lists, the one the viewer has on (remembered in this browser, with how
 * captions look), and that track's cues once they are loaded.
 */
export function useCaptions(src: string | null, enabled: boolean) {
  const [tracks, setTracks] = useState<CaptionTrack[]>([]);
  const [prefs, setPrefs] = useState<CaptionPrefs>(DEFAULT_CAPTION_PREFS);
  const [cues, setCues] = useState<{ trackId: string; cues: CaptionCue[] } | null>(null);
  const cache = useRef(new Map<string, CaptionCue[]>());

  // What this browser remembers, once it is in the browser.
  useEffect(() => setPrefs(parseCaptionPrefs(loadCaptions())), []);

  // The tracks, from the master playlist the player loads anyway.
  useEffect(() => {
    if (!enabled || !src) return;
    let stopped = false;
    const url = new URL(src, window.location.href).toString();
    fetchText(url)
      .then((text) => {
        if (!stopped) setTracks(parseSubtitleTracks(text, url));
      })
      .catch(() => {});
    return () => {
      stopped = true;
      setTracks([]);
    };
  }, [src, enabled]);

  const track = prefs.on ? pickTrack(tracks, prefs.lang) : null;
  const trackId = track?.id ?? null;

  // The words of the track that is on, fetched once per track.
  useEffect(() => {
    if (!trackId) return;
    const known = cache.current.get(trackId);
    if (known) {
      setCues({ trackId, cues: known });
      return;
    }
    let stopped = false;
    (async () => {
      const playlist = await fetchText(trackId);
      const files = subtitleSegments(playlist, trackId).slice(0, MAX_FILES);
      const texts = await Promise.all(files.map((f) => (f === trackId ? playlist : fetchText(f))));
      const all = texts.flatMap((t) => parseCaptionVtt(t)).sort((a, b) => a.start - b.start);
      cache.current.set(trackId, all);
      if (!stopped) setCues({ trackId, cues: all });
    })().catch(() => {});
    return () => {
      stopped = true;
    };
  }, [trackId]);

  const update = useCallback((next: (p: CaptionPrefs) => CaptionPrefs) => {
    setPrefs((p) => {
      const out = next(p);
      saveCaptions(captionPrefsText(out));
      return out;
    });
  }, []);

  /** A track on (and remembered as the viewer's language), or null for off. */
  const choose = useCallback(
    (t: CaptionTrack | null) => update((p) => (t ? { ...p, on: true, lang: t.lang || p.lang } : { ...p, on: false })),
    [update],
  );
  const setStyle = useCallback((style: CaptionStyle) => update((p) => ({ ...p, style })), [update]);

  return {
    tracks,
    track,
    cues: cues && cues.trackId === trackId ? cues.cues : [],
    style: prefs.style,
    lang: prefs.lang,
    choose,
    setStyle,
  };
}
