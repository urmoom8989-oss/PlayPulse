"use client";

import { useEffect, useRef, useState } from "react";
import { AddIcon, CloseIcon } from "@/components/icons";
import { playlistCall } from "@/lib/playlists/client";
import {
  PLAYLIST_TITLE_MAX,
  PLAYLIST_VISIBILITIES,
  playlistErrorText,
  savedToast,
  titleProblem,
  type PlaylistSummary,
  type PlaylistVisibility,
} from "@/lib/playlists/rules";
import { VisibilityIcon } from "./VisibilityIcon";

/**
 * The 2020 "Save to..." box: Watch later and your playlists with a tick each,
 * then "Create new playlist" with a name and who can see it. Every tick saves
 * at once and says so at the bottom left.
 */
export function SaveDialog({ videoId, onClose, toast }: { videoId: string; onClose: () => void; toast: (text: string) => void }) {
  const [lists, setLists] = useState<PlaylistSummary[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [visibility, setVisibility] = useState<PlaylistVisibility>("private");
  const [createError, setCreateError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let live = true;
    playlistCall<{ playlists: PlaylistSummary[] }>(`/api/playlists?video=${encodeURIComponent(videoId)}`)
      .then((r) => live && setLists(r.playlists))
      .catch((e: Error) => live && setLoadError(playlistErrorText(e.message)));
    return () => {
      live = false;
    };
  }, [videoId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    if (creating) nameRef.current?.focus();
  }, [creating]);

  async function toggle(list: PlaylistSummary) {
    if (busy.has(list.id)) return;
    const saved = !list.hasVideo;
    setBusy((b) => new Set(b).add(list.id));
    setLists((ls) => ls?.map((l) => (l.id === list.id ? { ...l, hasVideo: saved, count: l.count + (saved ? 1 : -1) } : l)) ?? null);
    try {
      const r = await playlistCall<{ count: number }>(`/api/playlists/${list.id}/videos`, "POST", { videoId, saved });
      setLists((ls) => ls?.map((l) => (l.id === list.id ? { ...l, count: r.count } : l)) ?? null);
      toast(savedToast(list.title, saved));
    } catch (e) {
      setLists((ls) => ls?.map((l) => (l.id === list.id ? { ...l, hasVideo: !saved, count: list.count } : l)) ?? null);
      toast(playlistErrorText(e instanceof Error ? e.message : "failed"));
    } finally {
      setBusy((b) => {
        const n = new Set(b);
        n.delete(list.id);
        return n;
      });
    }
  }

  async function create() {
    const problem = titleProblem(name);
    if (problem) {
      setCreateError(problem);
      return;
    }
    setSaving(true);
    setCreateError(null);
    try {
      const title = name.trim();
      const r = await playlistCall<{ id: string }>("/api/playlists", "POST", { title, visibility, videoId });
      const made: PlaylistSummary = {
        id: r.id,
        kind: "playlist",
        title,
        visibility,
        count: 1,
        hasVideo: true,
        updatedAt: new Date().toISOString(),
        firstVideoId: videoId,
        thumbnail: null,
      };
      setLists((ls) => (ls ? [ls[0], made, ...ls.slice(1)].filter(Boolean) : [made]));
      setCreating(false);
      setName("");
      toast(savedToast(title, true));
    } catch (e) {
      setCreateError(playlistErrorText(e instanceof Error ? e.message : "failed"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="save-title"
        data-save-dialog
        onClick={(e) => e.stopPropagation()}
        className="pp-fade-in w-full max-w-[300px] rounded-[2px] bg-surface shadow-[var(--menu-shadow)]"
      >
        <div className="flex items-center justify-between border-b border-divider py-1 pl-6 pr-2">
          <h2 id="save-title" className="text-[16px] font-normal text-text">
            Save to...
          </h2>
          <button type="button" aria-label="Close" onClick={onClose} className="grid h-10 w-10 place-items-center text-icon">
            <CloseIcon className="h-6 w-6" />
          </button>
        </div>

        <div className="max-h-[40vh] overflow-y-auto py-2" data-save-lists>
          {lists === null && !loadError && (
            <div className="grid place-items-center py-4">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-divider border-t-[var(--link)]" />
            </div>
          )}
          {loadError && <p className="px-6 py-2 text-[13px] text-[var(--error)]">{loadError}</p>}
          {lists?.map((l) => (
            <label key={l.id} className="flex h-10 cursor-pointer items-center gap-4 px-6 hover:bg-hover" data-save-list={l.kind}>
              <input
                type="checkbox"
                checked={l.hasVideo}
                onChange={() => void toggle(l)}
                disabled={busy.has(l.id)}
                className="h-[18px] w-[18px] shrink-0 accent-[var(--link)]"
              />
              <span className="min-w-0 flex-1 truncate text-[14px] text-text">{l.title}</span>
              <VisibilityIcon visibility={l.visibility} />
            </label>
          ))}
        </div>

        <div className="border-t border-divider">
          {!creating ? (
            <button
              type="button"
              onClick={() => setCreating(true)}
              data-save-create
              className="flex h-12 w-full items-center gap-4 px-6 text-left text-[14px] text-text hover:bg-hover"
            >
              <AddIcon className="h-6 w-6 text-icon" />
              Create new playlist
            </button>
          ) : (
            <form
              className="px-6 pb-3 pt-4"
              onSubmit={(e) => {
                e.preventDefault();
                void create();
              }}
            >
              <label className="block text-[12px] text-text-2" htmlFor="new-playlist-name">
                Name
              </label>
              <input
                id="new-playlist-name"
                ref={nameRef}
                value={name}
                maxLength={PLAYLIST_TITLE_MAX}
                onChange={(e) => {
                  setName(e.target.value);
                  setCreateError(null);
                }}
                placeholder="Enter playlist name..."
                data-save-name
                className="mt-1 w-full border-b border-divider bg-transparent pb-1 text-[14px] text-text outline-none focus:border-[var(--link)]"
              />
              <p className="mt-1 text-right text-[12px] text-text-2">
                {name.length}/{PLAYLIST_TITLE_MAX}
              </p>
              <label className="mt-2 block text-[12px] text-text-2" htmlFor="new-playlist-privacy">
                Privacy
              </label>
              <select
                id="new-playlist-privacy"
                value={visibility}
                onChange={(e) => setVisibility(e.target.value as PlaylistVisibility)}
                data-save-privacy
                className="mt-1 h-9 w-full border-b border-divider bg-surface text-[14px] text-text outline-none"
              >
                {PLAYLIST_VISIBILITIES.map((v) => (
                  <option key={v.value} value={v.value}>
                    {v.label}
                  </option>
                ))}
              </select>
              {createError && <p className="mt-2 text-[12px] text-[var(--error)]">{createError}</p>}
              <div className="mt-3 flex justify-end">
                <button
                  type="submit"
                  disabled={saving || name.trim().length === 0}
                  data-save-submit
                  className="h-9 px-3 text-[14px] font-medium uppercase text-[var(--link)] hover:bg-hover disabled:opacity-50"
                >
                  Create
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
