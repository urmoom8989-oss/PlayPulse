"use client";

import { useCallback, useEffect, useState } from "react";

/** The 2020 snackbar at the bottom left: one message at a time, gone after 4 seconds. */
export function useToast(): [React.ReactNode, (message: string) => void] {
  const [toast, setToast] = useState<{ text: string; n: number } | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);
  const show = useCallback((text: string) => setToast((old) => ({ text, n: (old?.n ?? 0) + 1 })), []);
  const node = toast ? (
    <div
      key={toast.n}
      role="status"
      data-playlist-toast
      className="pp-fade-in fixed bottom-6 left-6 z-[60] max-w-[calc(100vw-48px)] rounded-[2px] bg-[#323232] px-6 py-3.5 text-[14px] text-white shadow-lg"
    >
      {toast.text}
    </div>
  ) : null;
  return [node, show];
}
