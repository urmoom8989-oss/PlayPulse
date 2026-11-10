import { isPlaylistVisibility } from "@/lib/playlists/rules";
import { playlistAnswer } from "@/lib/playlists/http";
import { createPlaylist, myPlaylists } from "@/lib/playlists/server";
import { badRequest, isUuid, readJson } from "@/lib/studio/http";

// GET /api/playlists?video=<id>: your playlists, Watch later first, with
// whether that video is in each (the Save dialog; the guide and the library
// leave video out). 043_playlists.sql.
export async function GET(request: Request) {
  const video = new URL(request.url).searchParams.get("video");
  if (video !== null && !isUuid(video)) return badRequest();
  return playlistAnswer(await myPlaylists(video ? video.toLowerCase() : null));
}

// POST /api/playlists { title, visibility, videoId? }: a new playlist, with
// the video in it when one is given. Answers { id }.
export async function POST(request: Request) {
  const b = await readJson(request);
  if (
    !b ||
    typeof b.title !== "string" ||
    b.title.length > 1000 ||
    !isPlaylistVisibility(b.visibility) ||
    !(b.videoId === undefined || b.videoId === null || isUuid(b.videoId))
  ) {
    return badRequest();
  }
  const videoId = typeof b.videoId === "string" ? b.videoId.toLowerCase() : null;
  return playlistAnswer(await createPlaylist(b.title, b.visibility, videoId));
}
