import { playlistAnswer } from "@/lib/playlists/http";
import { movePlaylistVideo, setPlaylistVideo } from "@/lib/playlists/server";
import { badRequest, isUuid, readJson } from "@/lib/studio/http";

// POST /api/playlists/<id>/videos { videoId, saved }: adds a video to the end
// of one of your playlists, or takes it out. Answers { count }.
export async function POST(request: Request, ctx: RouteContext<"/api/playlists/[id]/videos">) {
  const { id } = await ctx.params;
  const b = await readJson(request);
  if (!isUuid(id) || !b || !isUuid(b.videoId) || typeof b.saved !== "boolean") return badRequest();
  return playlistAnswer(await setPlaylistVideo(id.toLowerCase(), b.videoId.toLowerCase(), b.saved));
}

// PATCH /api/playlists/<id>/videos { videoId, beforeId }: moves a video right
// before beforeId, or to the end when beforeId is null.
export async function PATCH(request: Request, ctx: RouteContext<"/api/playlists/[id]/videos">) {
  const { id } = await ctx.params;
  const b = await readJson(request);
  if (!isUuid(id) || !b || !isUuid(b.videoId) || !(b.beforeId === null || isUuid(b.beforeId))) return badRequest();
  const beforeId = typeof b.beforeId === "string" ? b.beforeId.toLowerCase() : null;
  return playlistAnswer(await movePlaylistVideo(id.toLowerCase(), b.videoId.toLowerCase(), beforeId));
}
