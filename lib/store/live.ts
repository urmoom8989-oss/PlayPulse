import { create } from "zustand";

/** How many are watching (or waiting), from the chat's presence pings, for the line under the title. */
type LiveState = {
  viewers: Record<string, number>;
  setViewers: (videoId: string, n: number) => void;
};

export const useLive = create<LiveState>((set, get) => ({
  viewers: {},
  setViewers: (videoId, n) => {
    if (get().viewers[videoId] !== n) set((s) => ({ viewers: { ...s.viewers, [videoId]: n } }));
  },
}));
