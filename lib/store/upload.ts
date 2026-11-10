"use client";

import { create } from "zustand";
import { probeVideoFile } from "../shorts/probe.ts";
import { shortProblem } from "../shorts/rules.ts";
import { useSession } from "./session.ts";
import { SpeedMeter, UploadCancelled, uploadParts, xhrPutPart, type SignedPart } from "../upload/parts.ts";
import {
  detailsProblem,
  fileProblem,
  titleFromFileName,
  uploadErrorText,
  videoTypeFor,
  type Details,
} from "../upload/rules.ts";
import { thumbnailFileProblem } from "../studio/rules.ts";
import { cardProblem, toPayload, type CardDraft } from "../cards/rules.ts";

export type UploadPhase = "idle" | "draft" | "signing" | "uploading" | "finishing" | "done" | "failed";

/**
 * The "Upload as a Snip" box (feature 11). The file's shape is read in the
 * browser when it is picked; the box can only be ticked when the file is
 * vertical and 60 seconds or less, else `problem` says why. Ticked by itself
 * when the file qualifies. Saved after the upload, with the shorts flag on.
 */
export type ShortBox = { state: "checking" | "ready"; problem: string | null; on: boolean };

type SignResponse = { videoId: string; uploadId: string; parts: SignedPart[] };

type UploadState = {
  phase: UploadPhase;
  step: 0 | 1 | 2;
  file: File | null;
  fileName: string;
  total: number;
  sent: number;
  speed: number;
  details: Details;
  videoId: string | null;
  watchUrl: string | null;
  thumbnailFile: File | null;
  thumbnailPreview: string | null;
  thumbnailSaving: boolean;
  thumbnailError: string | null;
  published: boolean;
  publishError: string | null;
  error: string | null;
  /** A short line under the drop zone, like "Upload cancelled". */
  notice: string | null;
  short: ShortBox;
  /** Cards from the "Video elements" step (041), saved when the upload is done. */
  cards: CardDraft[];
  pick: (file: File) => void;
  goToStep: (step: 0 | 1 | 2) => void;
  startUpload: () => Promise<void>;
  setDetails: (patch: Partial<Details>) => void;
  setThumbnailFile: (file: File | null) => void;
  setShortOn: (on: boolean) => void;
  setCards: (cards: CardDraft[]) => void;
  cancel: () => Promise<void>;
  reset: () => void;
};

const emptyDetails: Details = { title: "", description: "", visibility: "private", category: "Other" };
const checkingShort: ShortBox = { state: "checking", problem: null, on: false };

// The running upload lives outside the store: it is not something to render.
let running: { controller: AbortController; videoId: string | null; uploadId: string | null } | null = null;
// Counts picks, so a slow file probe never lands on the next file's box.
let picks = 0;

async function postJson<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  const json = (await res.json().catch(() => ({}))) as T & { error?: string; message?: string };
  if (!res.ok) throw new Error(json.message || uploadErrorText(json.error));
  return json;
}

async function uploadThumbnail(videoId: string, file: File): Promise<void> {
  const signed = await postJson<{ name: string; url: string }>("/api/upload/thumbnail/sign", {
    videoId,
    mime: file.type,
    bytes: file.size,
  });
  const put = await fetch(signed.url, { method: "PUT", headers: { "content-type": file.type }, body: file });
  if (!put.ok) throw new Error("The thumbnail upload did not finish. Try again.");
  await postJson("/api/upload/thumbnail", { videoId, name: signed.name });
}

function revokeThumbnailPreview(preview: string | null) {
  if (preview?.startsWith("blob:")) URL.revokeObjectURL(preview);
}

export const useUpload = create<UploadState>((set, get) => ({
  phase: "idle",
  step: 0,
  file: null,
  fileName: "",
  total: 0,
  sent: 0,
  speed: 0,
  details: emptyDetails,
  videoId: null,
  watchUrl: null,
  thumbnailFile: null,
  thumbnailPreview: null,
  thumbnailSaving: false,
  thumbnailError: null,
  published: false,
  publishError: null,
  error: null,
  notice: null,
  short: checkingShort,
  cards: [],

  pick(file) {
    if (running || !["idle", "draft"].includes(get().phase)) return;
    const problem = fileProblem(file);
    if (problem) {
      set({ notice: problem });
      return;
    }
    revokeThumbnailPreview(get().thumbnailPreview);
    const details = { ...emptyDetails, title: titleFromFileName(file.name) };
    set({
      phase: "draft",
      step: 0,
      file,
      fileName: file.name,
      total: file.size,
      sent: 0,
      speed: 0,
      details,
      videoId: null,
      watchUrl: null,
      thumbnailFile: null,
      thumbnailPreview: null,
      thumbnailSaving: false,
      thumbnailError: null,
      published: false,
      publishError: null,
      error: null,
      notice: null,
      short: checkingShort,
      cards: [],
    });

    const seq = ++picks;
    void probeVideoFile(file).then((shape) => {
      if (seq !== picks) return;
      const problem = shortProblem(shape);
      set({ short: { state: "ready", problem, on: problem === null } });
    });
  },

  goToStep(step) {
    if (get().phase !== "draft") return;
    set({ step, error: null });
  },

  async startUpload() {
    const { phase, step, file, details, thumbnailFile } = get();
    if (phase !== "draft" || step !== 2 || !file || running) return;
    const problem = detailsProblem(details);
    if (problem) {
      set({ error: problem });
      return;
    }
    const publishAfterUpload = details.visibility === "public";

    const mime = videoTypeFor(file);
    if (!mime) {
      set({ error: fileProblem(file) ?? uploadErrorText("bad_type") });
      return;
    }
    const controller = new AbortController();
    running = { controller, videoId: null, uploadId: null };
    const job = running;
    set({ phase: "signing", sent: 0, speed: 0, error: null, publishError: null });

    try {
      const signed = await postJson<SignResponse>(
        "/api/upload/sign",
        { title: details.title.trim(), bytes: file.size, mime },
        controller.signal,
      );
      job.videoId = signed.videoId;
      job.uploadId = signed.uploadId;
      set({ phase: "uploading", videoId: signed.videoId });

      const meter = new SpeedMeter();
      let lastPaint = 0;
      const parts = await uploadParts({
        file,
        parts: signed.parts,
        putPart: xhrPutPart,
        signal: controller.signal,
        onProgress: (sent) => {
          const speed = meter.add(sent);
          const now = Date.now();
          if (now - lastPaint > 200 || sent === file.size) {
            lastPaint = now;
            set({ sent, speed });
          }
        },
      });

      set({ phase: "finishing", sent: file.size });
      const currentDetails = get().details;
      const finalDetails = detailsProblem(currentDetails)
        ? { ...currentDetails, title: currentDetails.title.trim() || details.title }
        : currentDetails;
      const done = await postJson<{ watchUrl: string }>(
        "/api/upload/complete",
        { videoId: signed.videoId, uploadId: signed.uploadId, parts, ...finalDetails },
        controller.signal,
      );

      const selectedThumbnail = get().thumbnailFile ?? thumbnailFile;
      if (selectedThumbnail) {
        set({ thumbnailSaving: true, thumbnailError: null });
        try {
          await uploadThumbnail(signed.videoId, selectedThumbnail);
        } catch (thumbnailError) {
          set({
            thumbnailError:
              thumbnailError instanceof Error ? thumbnailError.message : "The thumbnail upload did not finish. Try again.",
          });
        } finally {
          set({ thumbnailSaving: false });
        }
      }

      if (publishAfterUpload) {
        try {
          await postJson("/api/upload/publish", { videoId: signed.videoId }, controller.signal);
          set({ published: true, publishError: null });
        } catch (publishError) {
          set({
            published: false,
            publishError: publishError instanceof Error ? publishError.message : "Could not publish the video.",
          });
        }
      }

      running = null;
      set({
        phase: "done",
        file: null,
        watchUrl: done.watchUrl,
        details: finalDetails,
      });
      const box = get().short;
      if (useSession.getState().flags.shorts && box.state === "ready" && box.problem === null) {
        void postJson("/api/shorts/choice", { videoId: signed.videoId, on: box.on }).catch(() => undefined);
      }
      // Cards from the "Video elements" step: the ones that are filled in and right.
      const ready = get().cards.filter((c) => c.target.trim() !== "" && cardProblem(c) === null);
      const payload = toPayload(ready);
      if (useSession.getState().flags.video_cards && ready.length > 0 && "cards" in payload) {
        void postJson("/api/studio/cards", { videoId: signed.videoId, cards: payload.cards }).catch(() => undefined);
      }
    } catch (err) {
      if (err instanceof UploadCancelled || controller.signal.aborted) return;
      running = null;
      if (job.videoId && job.uploadId) {
        void postJson("/api/upload/abort", { videoId: job.videoId, uploadId: job.uploadId }).catch(() => undefined);
      }
      set({ phase: "failed", error: (err as Error).message || uploadErrorText(null) });
    }
  },

  setDetails(patch) {
    set({ details: { ...get().details, ...patch } });
  },

  setThumbnailFile(file) {
    const current = get();
    if (file) {
      const problem = thumbnailFileProblem(file);
      if (problem) {
        set({ thumbnailError: problem });
        return;
      }
    }
    revokeThumbnailPreview(current.thumbnailPreview);
    const preview = file ? URL.createObjectURL(file) : null;
    set({ thumbnailFile: file, thumbnailPreview: preview, thumbnailError: null });
    if (file && current.phase === "done" && current.videoId) {
      set({ thumbnailSaving: true });
      void uploadThumbnail(current.videoId, file)
        .then(() => set({ thumbnailError: null }))
        .catch((err) => set({ thumbnailError: err instanceof Error ? err.message : "The thumbnail upload did not finish. Try again." }))
        .finally(() => set({ thumbnailSaving: false }));
    }
  },

  setCards(cards) {
    set({ cards });
  },

  setShortOn(on) {
    const { short: box, phase, videoId } = get();
    if (box.state !== "ready" || box.problem !== null) return;
    set({ short: { ...box, on } });
    // Changed after the upload finished: save it now.
    if (phase === "done" && videoId && useSession.getState().flags.shorts) {
      void postJson("/api/shorts/choice", { videoId, on }).catch(() => undefined);
    }
  },

  async cancel() {
    const job = running;
    running = null;
    if (!job) return;
    job.controller.abort();
    revokeThumbnailPreview(get().thumbnailPreview);
    set({ ...initialView(), notice: "Upload cancelled." });
    if (job.videoId && job.uploadId) {
      await postJson("/api/upload/abort", { videoId: job.videoId, uploadId: job.uploadId }).catch(() => undefined);
    }
  },

  reset() {
    if (running) return;
    picks++;
    revokeThumbnailPreview(get().thumbnailPreview);
    set(initialView());
  },
}));

function initialView() {
  return {
    phase: "idle" as const,
    step: 0 as const,
    file: null,
    fileName: "",
    total: 0,
    sent: 0,
    speed: 0,
    details: emptyDetails,
    videoId: null,
    watchUrl: null,
    thumbnailFile: null,
    thumbnailPreview: null,
    thumbnailSaving: false,
    thumbnailError: null,
    published: false,
    publishError: null,
    error: null,
    notice: null,
    short: checkingShort,
    cards: [] as CardDraft[],
  };
}
