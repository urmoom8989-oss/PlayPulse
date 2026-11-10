"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { formatStart, parseStart } from "@/lib/cards/rules";
import { removeWatermarks, resizeWatermark, uploadWatermark } from "@/lib/channels/watermark";
import { WATERMARK_SHOWS, watermarkErrorText, type Watermark, type WatermarkShow } from "@/lib/channels/watermark-rules";
import { createClient } from "@/lib/supabase/client";

/**
 * Channel customization's "Video watermark" (044), like 2020's branding
 * watermark: a picture in the bottom right corner of the player on your
 * videos (clicking it subscribes), and when it shows: the last 15 seconds,
 * from a custom start time, or the entire video. The picture saves as soon as
 * it is picked; the time with Save.
 */
export function WatermarkEditor({ ownerId, initial, disabled = false }: { ownerId: string; initial: Watermark | null; disabled?: boolean }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState(initial?.url ?? null);
  const [saved, setSaved] = useState({ show: initial?.show ?? ("end" as WatermarkShow), startS: initial?.startS ?? 0 });
  const [show, setShow] = useState<WatermarkShow>(saved.show);
  const [startText, setStartText] = useState(formatStart(saved.startS));
  const [busy, setBusy] = useState<"upload" | "save" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const startS = show === "custom" ? parseStart(startText) : 0;
  const timeError = show === "custom" && startS === null ? "Use m:ss, like 1:30." : null;
  const dirty = url !== null && (show !== saved.show || (show === "custom" && startS !== saved.startS));

  async function write(nextUrl: string | null, nextShow: WatermarkShow, nextStart: number) {
    const supabase = createClient();
    if (!supabase) throw new Error("database not connected");
    const { error: e } = await supabase.rpc("set_channel_watermark", { url: nextUrl, show: nextShow, start_s: nextStart });
    if (e) {
      const missing = e.code === "PGRST202" || e.code === "42883";
      throw new Error(watermarkErrorText(missing ? "not_set_up" : ["no_channel", "bad_url", "bad_show", "bad_time"].find((c) => e.message.includes(c)) ?? "failed"));
    }
  }

  async function pick(file: File | undefined) {
    if (!file) return;
    setError(null);
    setNote(null);
    const supabase = createClient();
    if (!supabase) return setError("database not connected");
    setBusy("upload");
    try {
      const blob = await resizeWatermark(file);
      const next = await uploadWatermark(supabase, ownerId, blob);
      const s = startS ?? saved.startS;
      await write(next, show, s);
      setUrl(next);
      setSaved({ show, startS: s });
      setNote("Watermark saved");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setBusy(null);
      if (input.current) input.current.value = "";
    }
  }

  async function remove() {
    setError(null);
    setNote(null);
    const supabase = createClient();
    if (!supabase) return setError("database not connected");
    setBusy("upload");
    try {
      await write(null, saved.show, saved.startS);
      await removeWatermarks(supabase, ownerId);
      setUrl(null);
      setNote("Watermark removed");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't remove it.");
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    if (!url || !dirty || timeError || startS === null) return;
    setError(null);
    setNote(null);
    setBusy("save");
    try {
      await write(url, show, startS);
      setSaved({ show, startS });
      setNote("Changes saved");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mt-6 bg-surface px-4 sm:px-8" data-watermark-editor={url ? "set" : "none"}>
      <section className="py-6 md:grid md:grid-cols-[220px_1fr] md:gap-8">
        <div className="mb-4 md:mb-0">
          <h2 className="text-[16px] font-medium leading-[22px] text-text">Video watermark</h2>
          <p className="mt-1 text-[13px] leading-[18px] text-text-2">
            Shows in the corner of the player on your videos. Viewers who click it subscribe. PNG, JPG or WebP, made 150 x 150.
          </p>
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-start gap-6">
            {/* A small player, with the watermark where viewers see it. */}
            <div className="relative aspect-video w-[240px] shrink-0 overflow-hidden rounded-[2px] bg-[#0f0f0f]" aria-hidden>
              <div className="absolute inset-x-0 bottom-0 h-1 bg-white/20">
                <div className="h-full w-2/3 bg-[var(--progress)]" />
              </div>
              {url && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={url} alt="" className="absolute bottom-3 right-3 h-8 w-8 object-contain opacity-80" data-watermark-preview />
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <input
                ref={input}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(e) => void pick(e.target.files?.[0])}
              />
              <button type="button" disabled={disabled || busy !== null} onClick={() => input.current?.click()} className="btn-blue" data-watermark-upload>
                {busy === "upload" ? "Uploading" : url ? "Change" : "Upload"}
              </button>
              {url && (
                <button type="button" disabled={disabled || busy !== null} onClick={() => void remove()} className="btn-text" data-watermark-remove>
                  Remove
                </button>
              )}
            </div>
          </div>

          <fieldset className="mt-6" disabled={disabled || busy !== null}>
            <legend className="mb-2 text-[14px] font-medium text-text">Display time</legend>
            <div className="space-y-2" role="radiogroup">
              {WATERMARK_SHOWS.map((s) => (
                <label key={s.value} className="flex cursor-pointer items-start gap-3">
                  <input
                    type="radio"
                    name="watermark-show"
                    value={s.value}
                    checked={show === s.value}
                    onChange={() => setShow(s.value)}
                    className="mt-0.5 h-[18px] w-[18px] accent-[var(--studio-accent)]"
                    data-watermark-show={s.value}
                  />
                  <span>
                    <span className="block text-[14px] text-text">{s.label}</span>
                    <span className="block text-[12px] text-text-2">{s.hint}</span>
                  </span>
                </label>
              ))}
            </div>
            {show === "custom" && (
              <div className="mt-3 pl-[30px]">
                <label className="block text-[12px] text-text-2" htmlFor="watermark-start">
                  Start time
                </label>
                <input
                  id="watermark-start"
                  value={startText}
                  onChange={(e) => setStartText(e.target.value)}
                  placeholder="0:00"
                  inputMode="numeric"
                  className="mt-1 h-9 w-[120px] rounded-[4px] border border-[var(--input-border)] bg-surface px-2 text-[14px] text-text outline-none focus:border-[var(--studio-accent)]"
                  data-watermark-start
                />
                {timeError && <p className="mt-1 text-[12px] text-[var(--error)]">{timeError}</p>}
              </div>
            )}
          </fieldset>

          <div className="mt-4 flex items-center gap-3">
            {url && (
              <button type="button" disabled={disabled || !dirty || busy !== null || Boolean(timeError)} onClick={() => void save()} className="btn-blue" data-watermark-save>
                {busy === "save" ? "Saving" : "Save"}
              </button>
            )}
            {!url && <p className="text-[13px] text-text-2">Upload a picture to turn the watermark on.</p>}
            {note && (
              <p role="status" className="text-[13px] text-text-2">
                {note}
              </p>
            )}
          </div>
          {error && (
            <p role="alert" className="mt-3 text-[13px] text-error">
              {error}
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
