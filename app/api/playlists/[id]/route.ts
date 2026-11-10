import { PLAYLIST_DESCRIPTION_MAX, isPlaylistVisibility } from "@/lib/playlists/rules";
import { playlistAnswer } from "@/lib/playlists/http";
import { deletePlaylist, updatePlaylist } from "@/lib/playlists/server";
import { badRequest, isUuid, readJson } from "@/lib/studio/http";

const optionalText = (v: unknown, max: number) => v === undefined || v === null || (typeof v === "string" && v.length <= max);

// PATCH /api/playlists/<id> { title?, description?, visibility? }: rename,
// describe, or change who can see one of your playlists.
export async function PATCH(request: Request, ctx: RouteContext<"/api/playlists/[id]">) {
  const { id } = await ctx.params;
  const b = await readJson(request);
  if (
    !isUuid(id) ||
    !b ||
    !optionalText(b.title, 1000) ||
    !optionalText(b.description, PLAYLIST_DESCRIPTION_MAX + 100) ||
    !(b.visibility === undefined || b.visibility === null || isPlaylistVisibility(b.visibility))
  ) {
    return badRequest();
  }
  return playlistAnswer(
    await updatePlaylist(id.toLowerCase(), {
      title: typeof b.title === "string" ? b.title : null,
      description: typeof b.description === "string" ? b.description : null,
      visibility: isPlaylistVisibility(b.visibility) ? b.visibility : null,
    }),
  );
}

// DELETE /api/playlists/<id>: deletes one of your playlists (not Watch later).
export async function DELETE(_request: Request, ctx: RouteContext<"/api/playlists/[id]">) {
  const { id } = await ctx.params;
  if (!isUuid(id)) return badRequest();
  return playlistAnswer(await deletePlaylist(id.toLowerCase()));
}
