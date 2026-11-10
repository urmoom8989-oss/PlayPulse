"use client";

import { useSyncExternalStore } from "react";

const noSubscribe = () => () => {};

/**
 * False on the server and while hydrating, true after: for text that depends
 * on the viewer's time zone, so the first render matches the server's.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    noSubscribe,
    () => true,
    () => false,
  );
}
