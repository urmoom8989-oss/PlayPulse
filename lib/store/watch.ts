import { create } from "zustand";
import { loadTheater, saveTheater } from "@/lib/watch/prefs";

/** A timestamp click asking the player to jump (player extras). `n` counts, so the same time twice still jumps. */
export type SeekRequest = { videoId: string; t: number; n: number };

type WatchState = {
  /** Theater mode: the player spans the whole width above the two columns. */
  theater: boolean;
  /** Where the player is, in whole seconds, for "Start at" in the share box. */
  currentTime: number;
  /** The video in the page's player, so timestamps know they can jump instead of loading the page. */
  playerVideoId: string | null;
  seek: SeekRequest | null;
  /** Reads the remembered theater setting once the page is in the browser. */
  syncTheater: () => void;
  toggleTheater: () => void;
  setCurrentTime: (t: number) => void;
  setPlayerVideo: (videoId: string) => void;
  /** Clears the player's video, unless another player took over in the meantime. */
  clearPlayerVideo: (videoId: string) => void;
  requestSeek: (videoId: string, t: number) => void;
};

export const useWatch = create<WatchState>((set, get) => ({
  theater: false,
  currentTime: 0,
  playerVideoId: null,
  seek: null,
  syncTheater: () => set({ theater: loadTheater() }),
  toggleTheater: () => {
    const theater = !get().theater;
    saveTheater(theater);
    set({ theater });
  },
  setCurrentTime: (t) => {
    const s = Math.floor(t);
    if (s !== get().currentTime) set({ currentTime: s });
  },
  setPlayerVideo: (videoId) => set({ playerVideoId: videoId }),
  clearPlayerVideo: (videoId) => {
    if (get().playerVideoId === videoId) set({ playerVideoId: null });
  },
  requestSeek: (videoId, t) => set({ seek: { videoId, t, n: (get().seek?.n ?? 0) + 1 } }),
}));
