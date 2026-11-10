// The playlist routes' answers: the error codes as HTTP statuses.

const noStore = { "Cache-Control": "no-store" };

export function playlistStatus(code: string): number {
  switch (code) {
    case "not_signed_in":
      return 401;
    case "off":
    case "banned":
    case "watch_later":
      return 403;
    case "not_found":
    case "video_not_found":
      return 404;
    case "no_db":
    case "not_set_up":
      return 503;
    case "failed":
      return 500;
    default:
      return 400;
  }
}

export function playlistAnswer<T extends object>(result: T | { error: string }) {
  if ("error" in result && typeof result.error === "string") {
    return Response.json(result, { status: playlistStatus(result.error), headers: noStore });
  }
  return Response.json(result, { headers: noStore });
}
