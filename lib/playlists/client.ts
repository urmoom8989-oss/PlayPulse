// The browser side of the playlist routes. Every change tells the rest of the
// page (the guide's list, the library) with a window event.

export const PLAYLISTS_CHANGED = "pp-playlists-changed";

/** Calls a playlist route; throws an Error whose message is the error code. */
export async function playlistCall<T = Record<string, unknown>>(
  url: string,
  method: "GET" | "POST" | "PATCH" | "DELETE" = "GET",
  body?: unknown,
): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || typeof json.error === "string") throw new Error(typeof json.error === "string" ? json.error : "failed");
  if (method !== "GET" && typeof window !== "undefined") window.dispatchEvent(new Event(PLAYLISTS_CHANGED));
  return json as T;
}
