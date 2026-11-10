"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type DragEvent } from "react";
import { Avatar } from "@/components/Avatar";
import { Menu, MenuDivider, MenuItem } from "@/components/Menu";
import { Thumb } from "@/components/Thumb";
import {
  DeleteIcon,
  DragHandleIcon,
  EditIcon,
  ExpandLessIcon,
  ExpandMoreIcon,
  MoreIcon,
  MoveBottomIcon,
  MoveTopIcon,
  PlayIcon,
  ShareIcon,
} from "@/components/icons";
import { playlistCall } from "@/lib/playlists/client";
import {
  PLAYLIST_DESCRIPTION_MAX,
  PLAYLIST_TITLE_MAX,
  PLAYLIST_VISIBILITIES,
  hiddenText,
  moveIn,
  playlistErrorText,
  titleProblem,
  videoCount,
  watchInList,
  type PlaylistHeader,
  type PlaylistItem,
  type PlaylistVisibility,
} from "@/lib/playlists/rules";
import { formatDate, formatTime } from "@/lib/watch/format";
import { useToast } from "./Toast";
import { VisibilityIcon } from "./VisibilityIcon";

/**
 * /playlist?list=<id>, the 2020 page: on the left the first video's picture
 * (Play all), the title, "12 videos · Last updated on ...", who can see it,
 * Play all and Share, the description and the owner; on the right the videos
 * in order. The owner renames it and changes the description in place, picks
 * public, unlisted or private, deletes it, and reorders the videos by
 * dragging them (or Move to top / bottom in each video's menu) or takes them out.
 */
export function PlaylistView({ header: first, items: firstItems }: { header: PlaylistHeader; items: PlaylistItem[] }) {
  const router = useRouter();
  const [header, setHeader] = useState(first);
  const [items, setItems] = useState(firstItems);
  const [toastNode, toast] = useToast();
  const owner = header.isOwner;
  const watchLater = header.kind === "watch_later";
  const playAll = items.length ? watchInList(items[0].id, header.id) : null;
  const hidden = hiddenText(header.hidden);

  async function patch(change: { title?: string; description?: string; visibility?: PlaylistVisibility }): Promise<boolean> {
    try {
      await playlistCall(`/api/playlists/${header.id}`, "PATCH", change);
      setHeader((h) => ({ ...h, ...change, updatedAt: new Date().toISOString() }));
      return true;
    } catch (e) {
      toast(playlistErrorText(e instanceof Error ? e.message : "failed"));
      return false;
    }
  }

  async function move(videoId: string, beforeId: string | null) {
    const before = items;
    const after = moveIn(items, videoId, beforeId);
    if (after.every((v, i) => v.id === before[i]?.id)) return;
    setItems(after);
    try {
      await playlistCall(`/api/playlists/${header.id}/videos`, "PATCH", { videoId, beforeId });
    } catch (e) {
      setItems(before);
      toast(playlistErrorText(e instanceof Error ? e.message : "failed"));
    }
  }

  async function remove(video: PlaylistItem) {
    const before = items;
    setItems(items.filter((v) => v.id !== video.id));
    setHeader((h) => ({ ...h, count: h.count - 1 }));
    try {
      await playlistCall(`/api/playlists/${header.id}/videos`, "POST", { videoId: video.id, saved: false });
      toast(`Removed from ${header.title}`);
    } catch (e) {
      setItems(before);
      setHeader((h) => ({ ...h, count: h.count + 1 }));
      toast(playlistErrorText(e instanceof Error ? e.message : "failed"));
    }
  }

  async function destroy() {
    if (!window.confirm(`Delete "${header.title}"? This can't be undone.`)) return;
    try {
      await playlistCall(`/api/playlists/${header.id}`, "DELETE");
      router.push("/library");
    } catch (e) {
      toast(playlistErrorText(e instanceof Error ? e.message : "failed"));
    }
  }

  async function share() {
    const link = `${window.location.origin}/playlist?list=${header.id}`;
    try {
      await navigator.clipboard.writeText(link);
      toast("Link copied to clipboard");
    } catch {
      toast(link);
    }
  }

  return (
    <div className="flex flex-col search:flex-row search:items-start" data-playlist-page={header.id} data-playlist-owner={owner ? "1" : undefined}>
      <aside className="bg-surface px-6 pb-6 pt-6 search:sticky search:top-14 search:w-[360px] search:shrink-0 search:self-stretch search:border-r search:border-divider">
        {playAll ? (
          <Link href={playAll} className="group relative block aspect-video overflow-hidden bg-skeleton" aria-label="Play all" data-playlist-cover>
            {header.thumbnail && <Thumb src={header.thumbnail} alt="" sizes="312px" />}
            <span className="absolute inset-0 grid place-items-center bg-black/70 text-[14px] font-medium uppercase tracking-[0.5px] text-white opacity-0 transition-opacity group-hover:opacity-100">
              <span className="flex items-center gap-2">
                <PlayIcon className="h-6 w-6" /> Play all
              </span>
            </span>
          </Link>
        ) : (
          <div className="aspect-video bg-skeleton" />
        )}

        <EditableTitle
          title={header.title}
          canEdit={owner && !watchLater}
          onSave={(title) => patch({ title })}
        />
        <p className="mt-1 text-[14px] leading-5 text-text-2" data-playlist-stats>
          {videoCount(header.count)} · Last updated on {formatDate(header.updatedAt)}
        </p>
        {hidden && <p className="mt-1 text-[12px] text-text-2">{hidden}</p>}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          {owner && !watchLater ? (
            <label className="flex items-center gap-2 text-[14px] text-text">
              <VisibilityIcon visibility={header.visibility} />
              <select
                value={header.visibility}
                onChange={(e) => void patch({ visibility: e.target.value as PlaylistVisibility })}
                aria-label="Who can see this playlist"
                data-playlist-visibility
                className="h-8 border-b border-divider bg-surface pr-1 text-[14px] text-text outline-none"
              >
                {PLAYLIST_VISIBILITIES.map((v) => (
                  <option key={v.value} value={v.value}>
                    {v.label}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <span className="flex items-center gap-1.5 text-[14px] text-text-2">
              <VisibilityIcon visibility={header.visibility} />
              {PLAYLIST_VISIBILITIES.find((v) => v.value === header.visibility)?.label}
            </span>
          )}
        </div>

        <div className="mt-4 flex items-center gap-2">
          {playAll ? (
            <Link href={playAll} className="btn-blue gap-2 uppercase" data-play-all>
              <PlayIcon className="h-5 w-5" /> Play all
            </Link>
          ) : (
            <span className="btn-blue cursor-not-allowed gap-2 uppercase opacity-60">
              <PlayIcon className="h-5 w-5" /> Play all
            </span>
          )}
          {!watchLater && header.visibility !== "private" && (
            <button type="button" onClick={() => void share()} aria-label="Share" title="Share" className="grid h-10 w-10 place-items-center rounded-full text-icon hover:bg-hover" data-playlist-share>
              <ShareIcon className="h-6 w-6 -scale-x-100" />
            </button>
          )}
          {owner && !watchLater && (
            <Menu label="More actions" width={220} button={<MoreIcon className="h-6 w-6" />}>
              {(close) => (
                <MenuItem
                  icon={<DeleteIcon className="h-6 w-6" />}
                  onClick={() => {
                    close();
                    void destroy();
                  }}
                >
                  Delete playlist
                </MenuItem>
              )}
            </Menu>
          )}
        </div>

        <EditableDescription
          description={header.description}
          canEdit={owner && !watchLater}
          onSave={(description) => patch({ description })}
        />

        <div className="mt-4 flex items-center gap-3 border-t border-divider pt-4">
          <Avatar name={header.owner.name} url={header.owner.avatarUrl} size={48} />
          {header.owner.handle ? (
            <Link href={`/@${header.owner.handle}`} className="truncate text-[14px] font-medium text-text" data-playlist-owner-name>
              {header.owner.name}
            </Link>
          ) : (
            <span className="truncate text-[14px] font-medium text-text" data-playlist-owner-name>
              {header.owner.name}
            </span>
          )}
        </div>
      </aside>

      <PlaylistList
        items={items}
        listId={header.id}
        listTitle={header.title}
        owner={owner}
        onMove={(id, beforeId) => void move(id, beforeId)}
        onRemove={(v) => void remove(v)}
      />
      {toastNode}
    </div>
  );
}

function EditableTitle({ title, canEdit, onSave }: { title: string; canEdit: boolean; onSave: (t: string) => Promise<boolean> }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  const [busy, setBusy] = useState(false);
  const problem = titleProblem(draft);
  if (!editing) {
    return (
      <div className="mt-4 flex items-start gap-2">
        <h1 className="min-w-0 flex-1 break-words text-[20px] font-normal leading-7 text-text" data-playlist-title>
          {title}
        </h1>
        {canEdit && (
          <button
            type="button"
            aria-label="Rename the playlist"
            title="Rename"
            onClick={() => {
              setDraft(title);
              setEditing(true);
            }}
            className="-mr-2 grid h-9 w-9 shrink-0 place-items-center rounded-full text-icon hover:bg-hover"
            data-playlist-rename
          >
            <EditIcon className="h-5 w-5" />
          </button>
        )}
      </div>
    );
  }
  return (
    <form
      className="mt-4"
      onSubmit={async (e) => {
        e.preventDefault();
        if (problem || busy) return;
        setBusy(true);
        if (await onSave(draft.trim())) setEditing(false);
        setBusy(false);
      }}
    >
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        maxLength={PLAYLIST_TITLE_MAX}
        autoFocus
        aria-label="Playlist name"
        data-playlist-title-input
        className="w-full border-b-2 border-[var(--link)] bg-transparent pb-1 text-[20px] leading-7 text-text outline-none"
      />
      <div className="mt-1 flex items-center justify-between text-[12px] text-text-2">
        <span className={problem ? "text-[var(--error)]" : ""}>{problem ?? ""}</span>
        <span>
          {draft.length}/{PLAYLIST_TITLE_MAX}
        </span>
      </div>
      <div className="mt-2 flex justify-end gap-2">
        <button type="button" onClick={() => setEditing(false)} className="h-9 px-3 text-[14px] font-medium uppercase text-text-2 hover:bg-hover">
          Cancel
        </button>
        <button type="submit" disabled={Boolean(problem) || busy} className="h-9 px-3 text-[14px] font-medium uppercase text-[var(--link)] hover:bg-hover disabled:opacity-50" data-playlist-title-save>
          Save
        </button>
      </div>
    </form>
  );
}

function EditableDescription({ description, canEdit, onSave }: { description: string; canEdit: boolean; onSave: (d: string) => Promise<boolean> }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(description);
  const [busy, setBusy] = useState(false);
  if (!editing) {
    if (!description && !canEdit) return null;
    return (
      <div className="mt-4 flex items-start gap-2">
        <p className={`min-w-0 flex-1 whitespace-pre-wrap break-words text-[14px] leading-5 ${description ? "text-text" : "text-text-2"}`} data-playlist-description>
          {description || "No description"}
        </p>
        {canEdit && (
          <button
            type="button"
            aria-label="Edit the description"
            title="Edit description"
            onClick={() => {
              setDraft(description);
              setEditing(true);
            }}
            className="-mr-2 grid h-9 w-9 shrink-0 place-items-center rounded-full text-icon hover:bg-hover"
          >
            <EditIcon className="h-5 w-5" />
          </button>
        )}
      </div>
    );
  }
  return (
    <form
      className="mt-4"
      onSubmit={async (e) => {
        e.preventDefault();
        if (busy) return;
        setBusy(true);
        if (await onSave(draft)) setEditing(false);
        setBusy(false);
      }}
    >
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        maxLength={PLAYLIST_DESCRIPTION_MAX}
        rows={4}
        autoFocus
        aria-label="Playlist description"
        className="w-full resize-y border-b-2 border-[var(--link)] bg-transparent text-[14px] leading-5 text-text outline-none"
      />
      <div className="mt-2 flex justify-end gap-2">
        <button type="button" onClick={() => setEditing(false)} className="h-9 px-3 text-[14px] font-medium uppercase text-text-2 hover:bg-hover">
          Cancel
        </button>
        <button type="submit" disabled={busy} className="h-9 px-3 text-[14px] font-medium uppercase text-[var(--link)] hover:bg-hover disabled:opacity-50">
          Save
        </button>
      </div>
    </form>
  );
}

/** The videos, in order. The owner drags a row by its handle to move it. */
function PlaylistList({
  items,
  listId,
  listTitle,
  owner,
  onMove,
  onRemove,
}: {
  items: PlaylistItem[];
  listId: string;
  listTitle: string;
  owner: boolean;
  onMove: (videoId: string, beforeId: string | null) => void;
  onRemove: (v: PlaylistItem) => void;
}) {
  const [dragId, setDragId] = useState<string | null>(null);
  // Where the dragged row would land: before this id, or at the end (null).
  const [dropBefore, setDropBefore] = useState<string | null | undefined>(undefined);

  function over(e: DragEvent<HTMLLIElement>, index: number) {
    if (!dragId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const rect = e.currentTarget.getBoundingClientRect();
    const lower = e.clientY > rect.top + rect.height / 2;
    const target = lower ? (items[index + 1]?.id ?? null) : items[index].id;
    setDropBefore(target);
  }

  function end() {
    setDragId(null);
    setDropBefore(undefined);
  }

  if (items.length === 0) {
    return (
      <div className="flex-1 px-6 py-10 text-center text-[14px] text-text-2" data-playlist-empty>
        No videos in this playlist yet. Use Save under any video to add it.
      </div>
    );
  }

  return (
    <ol className="min-w-0 flex-1 py-2 search:px-4" data-playlist-list>
      {items.map((v, i) => {
        const href = watchInList(v.id, listId);
        const lineAbove = dragId !== null && dropBefore === v.id && dragId !== v.id;
        const lineBelow = dragId !== null && dropBefore === null && i === items.length - 1 && dragId !== v.id;
        return (
          <li
            key={v.id}
            draggable={owner}
            onDragStart={(e) => {
              setDragId(v.id);
              e.dataTransfer.effectAllowed = "move";
              e.dataTransfer.setData("text/plain", v.id);
            }}
            onDragOver={(e) => over(e, i)}
            onDrop={(e) => {
              e.preventDefault();
              if (dragId && dropBefore !== undefined) onMove(dragId, dropBefore);
              end();
            }}
            onDragEnd={end}
            data-playlist-row={v.id}
            className={`group/row relative flex items-center gap-2 py-2 pr-1 hover:bg-hover ${dragId === v.id ? "opacity-50" : ""}`}
          >
            {lineAbove && <span className="absolute inset-x-0 top-0 h-0.5 bg-[var(--link)]" aria-hidden />}
            {lineBelow && <span className="absolute inset-x-0 bottom-0 h-0.5 bg-[var(--link)]" aria-hidden />}
            <span className="grid w-8 shrink-0 place-items-center text-[14px] text-text-2" data-playlist-index>
              {owner ? (
                <>
                  <span className="search:group-hover/row:hidden">{i + 1}</span>
                  <DragHandleIcon className="hidden h-6 w-6 cursor-grab text-icon search:group-hover/row:block" />
                </>
              ) : (
                i + 1
              )}
            </span>
            <Link href={href} className="relative block aspect-video w-[120px] shrink-0 overflow-hidden bg-skeleton" tabIndex={-1} aria-hidden draggable={false}>
              <Thumb src={v.thumbnail} alt="" sizes="120px" />
              {v.durationS !== null && (
                <span className="absolute bottom-1 right-1 bg-black/80 px-1 py-[3px] text-[12px] font-medium leading-3 text-white">{formatTime(v.durationS)}</span>
              )}
            </Link>
            <div className="min-w-0 flex-1 pl-2">
              <h3 className="line-clamp-2 text-[14px] font-medium leading-5 text-text">
                <Link href={href} draggable={false}>
                  {v.title}
                </Link>
              </h3>
              <p className="mt-0.5 truncate text-[13px] leading-[18px] text-text-2">
                <Link href={`/@${v.channel.handle}`} className="hover:text-text" draggable={false}>
                  {v.channel.name}
                </Link>
              </p>
            </div>
            {owner && (
              <Menu label={`Actions for ${v.title}`} width={260} button={<MoreIcon className="h-6 w-6" />}>
                {(close) => (
                  <>
                    <MenuItem
                      icon={<MoveTopIcon className="h-6 w-6" />}
                      disabled={i === 0}
                      onClick={() => {
                        close();
                        onMove(v.id, items[0].id);
                      }}
                    >
                      Move to top
                    </MenuItem>
                    <MenuItem
                      icon={<ExpandLessIcon className="h-6 w-6" />}
                      disabled={i === 0}
                      onClick={() => {
                        close();
                        onMove(v.id, items[i - 1].id);
                      }}
                    >
                      Move up
                    </MenuItem>
                    <MenuItem
                      icon={<ExpandMoreIcon className="h-6 w-6" />}
                      disabled={i === items.length - 1}
                      onClick={() => {
                        close();
                        onMove(v.id, items[i + 2]?.id ?? null);
                      }}
                    >
                      Move down
                    </MenuItem>
                    <MenuItem
                      icon={<MoveBottomIcon className="h-6 w-6" />}
                      disabled={i === items.length - 1}
                      onClick={() => {
                        close();
                        onMove(v.id, null);
                      }}
                    >
                      Move to bottom
                    </MenuItem>
                    <MenuDivider />
                    <MenuItem
                      icon={<DeleteIcon className="h-6 w-6" />}
                      onClick={() => {
                        close();
                        onRemove(v);
                      }}
                    >
                      Remove from {listTitle}
                    </MenuItem>
                  </>
                )}
              </Menu>
            )}
          </li>
        );
      })}
    </ol>
  );
}
