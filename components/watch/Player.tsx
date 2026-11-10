"use client";

import type Hls from "hls.js";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  DefaultViewIcon,
  FullscreenExitIcon,
  FullscreenIcon,
  PauseIcon,
  PipIcon,
  PlayIcon,
  ReplayIcon,
  SettingsIcon,
  SubtitlesIcon,
  TheaterIcon,
  VolumeDownIcon,
  VolumeOffIcon,
  VolumeUpIcon,
} from "@/components/icons";
import { resumeAt } from "@/lib/engagement/rules";
import type { WatchEngagement } from "@/lib/engagement/types";
import { useWatchPings } from "@/lib/engagement/useWatchPings";
import { useRouter } from "next/navigation";
import { useFlag } from "@/lib/store/session";
import { useWatch } from "@/lib/store/watch";
import {
  activeCues,
  CAPTION_SETTINGS,
  captionChoices,
  captionValueLabel,
  DEFAULT_CAPTION_STYLE,
  pickTrack,
  setCaptionSetting,
  stepCaptionSize,
  type CaptionSetting,
  type CaptionTrack,
} from "@/lib/watch/captions";
import { chapterAt, parseChapters } from "@/lib/watch/chapters";
import { endChoice, endScreenVideos, nextVideo } from "@/lib/watch/endscreen";
import { formatTime } from "@/lib/watch/format";
import { clampTime, FRAME_S, keyAction, stepSpeed, stepVolume, type PlayerAction } from "@/lib/watch/keys";
import { atLiveEdge } from "@/lib/live/state";
import { useT } from "@/lib/i18n/client";
import { loadQuality, loadResume, loadVolume, saveQuality, saveResume, saveVolume } from "@/lib/watch/prefs";
import {
  AUTO,
  levelForSaved,
  levelForSize,
  parseVariants,
  qualityOptions,
  qualitySummary,
  SPEEDS,
  speedLabel,
  type QualityOption,
  type Variant,
} from "@/lib/watch/quality";
import { menuPosition, watchLink } from "@/lib/watch/nerds";
import { DOUBLE_TAP_MS, nextTap, tapSide, tapTotal, type TapSide, type TapState } from "@/lib/watch/taps";
import type { UpNextVideo } from "@/lib/watch/types";
import { cueAt, parseSpriteVtt, type SpriteCue } from "@/lib/watch/vtt";
import { ChapterTrack } from "./ChapterTrack";
import { CaptionOverlay } from "./CaptionOverlay";
import { AutoplayCountdown, EndScreenWall } from "./EndScreen";
import type { WatchCard } from "@/lib/cards/rules";
import { VideoCards } from "./VideoCards";
import { Watermark } from "./Watermark";
import type { PlayerWatermark } from "@/lib/channels/watermark-rules";

/** How long "Includes paid promotion" stays at the start of a video (042), like 2020. */
const PAID_PROMOTION_S = 10;
import { PlayerContextMenu } from "./PlayerContextMenu";
import { StatsForNerds } from "./StatsForNerds";
import { useCaptions } from "./useCaptions";

type Props = {
  videoId: string;
  /** master.m3u8, or null in a preview without media. */
  src: string | null;
  poster: string | null;
  spriteVtt: string | null;
  /** From the database, so the bar has a length before the playlist loads. */
  durationS: number | null;
  /** ?t= from a shared link, in seconds. Wins over the remembered position. */
  startAt: number;
  /**
   * With the engagement flag on (feature 9): the player sends view pings, and
   * for a signed in viewer starts from the position saved in their history.
   * Signed out, or with the flag off, the browser's own position is used.
   */
  engagement?: WatchEngagement | null;
  /** /embed/<id> (feature 16): no theater mode, there is no page around it. */
  embed?: boolean;
  /** The description, for chapters on the progress bar (player extras). */
  description?: string;
  /** Up next, for autoplay and the end screen (player extras). */
  upNext?: UpNextVideo[];
  /** The channel, for Up next cards that have no channel of their own. */
  channelName?: string;
  /**
   * A Premiere or live broadcast that is on (028): the media route serves a
   * growing playlist, the player starts at the live edge, and LIVE replaces
   * the time until `endsAt` (ms). After that it is a normal video.
   */
  live?: { endsAt: number } | null;
  /** Low quality first (038): 720p and up are still being made; the quality menu says so. */
  hdPending?: boolean;
  /** Cards (041): messages that slide in at their time, and the i list. */
  cards?: WatchCard[];
  /** "Includes paid promotion" in the corner for the first seconds (042). */
  paidPromotion?: boolean;
  /** Played from a playlist (043): where the next video in it plays, right when this one ends. */
  listNext?: string | null;
  /** The channel's watermark in the bottom right corner (044). */
  watermark?: PlayerWatermark | null;
};

type Menu = null | "main" | "quality" | "speed" | "subtitles" | "caption-options" | `caption-${CaptionSetting}`;

/** Controls fade out after this long without the mouse moving, while playing. */
const IDLE_MS = 2500;
/** The resume position is saved this often while playing. */
const RESUME_EVERY_S = 5;
/** A key press note (volume, subtitles) stays this long. */
const NOTE_MS = 1200;
/** The "Resumed" note stays this long after playback starts. */
const RESUMED_MS = 3000;
/** After captions go on, the track's name shows this long (until the first words). */
const CAPTION_HINT_MS = 3000;

/**
 * Plays a rendition's playlist in place of the master one (native HLS, where
 * that is how a quality is picked), keeping the time, speed and play state.
 */
function swapSource(video: HTMLVideoElement, url: string) {
  const at = video.currentTime;
  const wasPaused = video.paused;
  const rate = video.playbackRate;
  video.src = url;
  video.addEventListener(
    "loadedmetadata",
    () => {
      if (at > 0) video.currentTime = at;
      video.playbackRate = rate;
      if (!wasPaused) video.play().catch(() => {});
    },
    { once: true },
  );
}

/**
 * The video player, in the 2019 YouTube style: red progress bar with sprite
 * previews on hover, a big play button while paused, and a bottom bar with
 * play, volume, time, CC (player extras), the settings gear (speed,
 * Subtitles/CC and quality), theater, picture in picture and fullscreen. hls.js in every browser that can run it
 * (Safari on a Mac and iPad too, and iPhones on iOS 17.1 or later), so the quality menu works everywhere; a browser
 * without it plays HLS itself, and picking a quality there plays that rendition's playlist.
 */
export function Player({
  videoId,
  src,
  poster,
  spriteVtt,
  durationS,
  startAt,
  engagement = null,
  embed = false,
  description = "",
  upNext = [],
  channelName = "",
  live = null,
  hdPending = false,
  cards = [],
  paidPromotion = false,
  listNext = null,
  watermark = null,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const volumeRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const gearRef = useRef<HTMLButtonElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  // Native HLS only: the renditions of the master playlist, by quality menu level.
  const variantsRef = useRef<Variant[]>([]);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lastSaved = useRef(0);

  const theater = useWatch((s) => s.theater);
  const toggleTheater = useWatch((s) => s.toggleTheater);
  const setStoreTime = useWatch((s) => s.setCurrentTime);

  const [playing, setPlaying] = useState(false);
  const [started, setStarted] = useState(false);
  const [ended, setEnded] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(durationS ?? 0);
  const [buffered, setBuffered] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [rate, setRate] = useState(1);
  const [options, setOptions] = useState<QualityOption[]>([]);
  const [chosen, setChosen] = useState(AUTO);
  const [playingLevel, setPlayingLevel] = useState(-1);
  const [native, setNative] = useState(false);
  const [menu, setMenu] = useState<Menu>(null);
  const [active, setActive] = useState(true);
  const [hover, setHover] = useState<{ x: number; t: number; w: number } | null>(null);
  const [scrubbing, setScrubbing] = useState(false);
  const [volumeDrag, setVolumeDrag] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [pipOk, setPipOk] = useState(false);
  const [cues, setCues] = useState<SpriteCue[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [resumed, setResumed] = useState(false);
  // While a broadcast is on: LIVE instead of the time. Off once it has ended.
  const [liveOver, setLiveOver] = useState(false);
  const liveEndsAt = live?.endsAt ?? null;
  const onAir = liveEndsAt !== null && !liveOver;
  useEffect(() => {
    if (liveEndsAt === null) return;
    const t = setTimeout(() => setLiveOver(true), Math.max(0, liveEndsAt - Date.now()) + 1000);
    return () => clearTimeout(t);
  }, [liveEndsAt]);
  // A short note after a key press (volume, mute, subtitles), also read out by screen readers.
  const [note, setNote] = useState<string | null>(null);
  const noteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flash = useCallback((text: string) => {
    setNote(text);
    if (noteTimer.current) clearTimeout(noteTimer.current);
    noteTimer.current = setTimeout(() => setNote(null), NOTE_MS);
  }, []);

  // Player extras: chapters, timestamps that jump here, the right-click menu
  // with Loop, the links and Stats for nerds, and double tap to skip on phones.
  const extras = useFlag("player_extras");
  const t = useT();
  // The rest of the 2020 keys: < > speed, , . frames while paused, Home and End.
  const moreKeys = useFlag("more_shortcuts");
  const [loop, setLoop] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<{ left: number; top: number } | null>(null);
  const [nerds, setNerds] = useState(false);
  const [engine, setEngine] = useState("");
  const [tapNote, setTapNote] = useState<{ side: TapSide; total: number; key: number } | null>(null);
  const tapRef = useRef<TapState | null>(null);
  const tapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pointerType = useRef("mouse");
  const menuOpen = useRef(false);
  const setPlayerVideo = useWatch((s) => s.setPlayerVideo);
  const clearPlayerVideo = useWatch((s) => s.clearPlayerVideo);
  const seekRequest = useWatch((s) => s.seek);
  // A request from before this player existed is not for it.
  const [firstSeek] = useState(() => useWatch.getState().seek?.n ?? 0);
  const handledSeek = useRef(firstSeek);
  const chapters = useMemo(
    () => (extras && description ? parseChapters(description, durationS ?? (duration > 0 ? duration : null)) : []),
    [extras, description, durationS, duration],
  );

  // The end of the video (player extras): autoplay's countdown, or the wall.
  const router = useRouter();
  const autoplay = useWatch((s) => s.autoplay);
  const syncAutoplay = useWatch((s) => s.syncAutoplay);
  const [endState, setEnding] = useState<"countdown" | "wall" | null>(null);
  const wall = useMemo(() => endScreenVideos(upNext, videoId), [upNext, videoId]);
  const next = useMemo(() => nextVideo(upNext, videoId), [upNext, videoId]);

  // Captions (player extras): the tracks the encoder made, drawn in the viewer's style.
  const captions = useCaptions(src, extras);
  const [captionHint, setCaptionHint] = useState<string | null>(null);
  const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [playerH, setPlayerH] = useState(0);

  // The server only hands engagement over when the flag is on for this
  // viewer, so this is known from the first render and the stream loads once.
  const engagementOn = engagement !== null;
  // A signed in viewer resumes from their history (past 10 s, before 90%).
  // null: use the position this browser remembers.
  const serverStart =
    engagementOn && engagement?.signedIn ? resumeAt(engagement.positionS, engagement.durationS ?? durationS) : null;
  useWatchPings(videoId, videoRef, engagementOn);

  // Load the stream -------------------------------------------------------------------

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return;
    let cancelled = false;
    let hls: Hls | null = null;
    const saved = loadQuality();
    // A broadcast that is on starts at the live edge, never at a saved position.
    const start = liveEndsAt !== null ? 0 : startAt > 0 ? startAt : (serverStart ?? loadResume(videoId));
    setResumed(liveEndsAt === null && startAt <= 0 && serverStart !== null && serverStart > 0);
    const v = loadVolume();
    video.volume = v.volume;
    video.muted = v.muted;
    setVolume(v.volume);
    setMuted(v.muted);
    setPipOk(typeof document !== "undefined" && document.pictureInPictureEnabled === true);

    const tryAutoplay = () => {
      video.play().catch(() => {
        // Autoplay with sound is often blocked: the big play button is there.
      });
    };

    // Without hls.js the browser plays HLS itself: the quality menu lists the
    // master playlist's renditions, and picking one plays its own playlist.
    let onResize: (() => void) | null = null;
    const playNative = async () => {
      setNative(true);
      setEngine("native HLS");
      const master = new URL(src, window.location.href).toString();
      let variants: Variant[] = [];
      try {
        const res = await fetch(master);
        if (res.ok) variants = parseVariants(await res.text(), master);
      } catch {
        // No list: Auto only, the browser still plays the master playlist.
      }
      if (cancelled) return;
      variantsRef.current = variants;
      const opts = qualityOptions(variants);
      setOptions(opts);
      const level = levelForSaved(opts, saved);
      setChosen(level);
      // The picture's size tells which rendition the browser plays on Auto.
      onResize = () => setPlayingLevel(levelForSize(opts, video.videoWidth, video.videoHeight));
      video.addEventListener("resize", onResize);
      video.src = level === AUTO ? master : variants[level].uri;
      video.addEventListener(
        "loadedmetadata",
        () => {
          if (start > 0) video.currentTime = start;
          tryAutoplay();
        },
        { once: true },
      );
    };

    void import("hls.js").then(({ default: HlsClass }) => {
      if (cancelled) return;
      if (!HlsClass.isSupported()) {
        if (video.canPlayType("application/vnd.apple.mpegurl")) void playNative();
        else setError("This browser can't play this video.");
        return;
      }
      // iPhones have only ManagedMediaSource, which plays when AirPlay is off for the element.
      if (!("MediaSource" in window) && "ManagedMediaSource" in window) video.disableRemotePlayback = true;
      hls = new HlsClass({
        startPosition: start > 0 ? start : -1,
        maxBufferLength: 30,
        backBufferLength: 60,
        // Classic MediaSource where there is one (Safari on a Mac keeps AirPlay).
        preferManagedMediaSource: false,
      });
      hlsRef.current = hls;
      setEngine(`hls.js ${HlsClass.version}`);
      hls.on(HlsClass.Events.MANIFEST_PARSED, (_e, data) => {
        const opts = qualityOptions(data.levels.map((l) => ({ height: l.height, width: l.width, bitrate: l.bitrate })));
        setOptions(opts);
        const level = levelForSaved(opts, saved);
        setChosen(level);
        if (hls && level !== AUTO) {
          hls.startLevel = level;
          hls.currentLevel = level;
        }
        tryAutoplay();
      });
      hls.on(HlsClass.Events.LEVEL_SWITCHED, (_e, data) => setPlayingLevel(data.level));
      hls.on(HlsClass.Events.ERROR, (_e, data) => {
        if (!data.fatal || !hls) return;
        if (data.type === HlsClass.ErrorTypes.NETWORK_ERROR) hls.startLoad();
        else if (data.type === HlsClass.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
        else setError("Something went wrong playing this video. Reload the page to try again.");
      });
      hls.loadSource(new URL(src, window.location.href).toString());
      hls.attachMedia(video);
    });

    return () => {
      cancelled = true;
      hls?.destroy();
      hlsRef.current = null;
      if (video.getAttribute("src")) {
        video.removeAttribute("src");
        video.load();
      }
      variantsRef.current = [];
      if (onResize) video.removeEventListener("resize", onResize);
    };
  }, [src, startAt, videoId, serverStart, liveEndsAt]);

  // "Resumed" fades a moment after playback starts.
  useEffect(() => {
    if (!resumed || !started) return;
    const t = setTimeout(() => setResumed(false), RESUMED_MS);
    return () => clearTimeout(t);
  }, [resumed, started]);

  // The hover sprite ------------------------------------------------------------------

  useEffect(() => {
    if (!spriteVtt) return;
    let stopped = false;
    const url = new URL(spriteVtt, window.location.href).toString();
    fetch(url)
      .then((r) => (r.ok ? r.text() : ""))
      .then((text) => {
        if (stopped) return;
        const parsed = parseSpriteVtt(text, url);
        setCues(parsed);
        if (parsed[0]) new Image().src = parsed[0].url;
      })
      .catch(() => {});
    return () => {
      stopped = true;
    };
  }, [spriteVtt]);

  // Remember where the video was left -------------------------------------------------

  useEffect(() => {
    const save = () => {
      const video = videoRef.current;
      if (video && video.currentTime > 0) saveResume(videoId, video.currentTime, video.duration);
    };
    window.addEventListener("pagehide", save);
    return () => {
      save();
      window.removeEventListener("pagehide", save);
    };
  }, [videoId]);

  // Fullscreen ------------------------------------------------------------------------

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === wrapRef.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  // The browser's own captions stay off (Safari may turn them on by itself):
  // with player extras the player draws them.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !extras || !video.textTracks) return;
    const tracks = video.textTracks;
    const off = () => {
      for (const t of Array.from(tracks)) if ((t.kind === "subtitles" || t.kind === "captions") && t.mode === "showing") t.mode = "disabled";
    };
    off();
    tracks.addEventListener("addtrack", off);
    tracks.addEventListener("change", off);
    return () => {
      tracks.removeEventListener("addtrack", off);
      tracks.removeEventListener("change", off);
    };
  }, [extras]);

  // The player's height, for the caption size and the settings menu.
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const measure = () => setPlayerH(wrap.getBoundingClientRect().height);
    // ResizeObserver also reports the first size right after observe().
    if (typeof ResizeObserver === "undefined") {
      const raf = requestAnimationFrame(measure);
      return () => cancelAnimationFrame(raf);
    }
    const ro = new ResizeObserver(measure);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, []);

  useEffect(
    () => () => {
      if (hintTimer.current) clearTimeout(hintTimer.current);
    },
    [],
  );

  // Actions ---------------------------------------------------------------------------

  const poke = useCallback(() => {
    setActive(true);
    clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => setActive(false), IDLE_MS);
  }, []);

  useEffect(() => () => clearTimeout(idleTimer.current), []);

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video || !src) return;
    if (video.paused || video.ended) video.play().catch(() => {});
    else video.pause();
  }, [src]);

  const seekTo = useCallback((t: number) => {
    const video = videoRef.current;
    if (!video) return;
    const d = Number.isFinite(video.duration) ? video.duration : duration;
    video.currentTime = clampTime(t, d);
    setTime(video.currentTime);
  }, [duration]);

  /** LIVE: back to the live edge (hls.js knows it; Safari uses the end of what can be seeked). */
  const goLive = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    const edge = hlsRef.current?.liveSyncPosition ?? (video.seekable.length ? video.seekable.end(video.seekable.length - 1) - 3 : null);
    if (edge !== null && Number.isFinite(edge)) seekTo(edge);
    if (video.paused) video.play().catch(() => {});
  }, [seekTo]);

  const toggleFullscreen = useCallback(() => {
    const wrap = wrapRef.current;
    const video = videoRef.current as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null;
    if (!wrap || !video) return;
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    else if (wrap.requestFullscreen) void wrap.requestFullscreen().catch(() => {});
    else video.webkitEnterFullscreen?.();
  }, []);

  const togglePip = useCallback(() => {
    const video = videoRef.current;
    if (!video || !document.pictureInPictureEnabled) return;
    if (document.pictureInPictureElement) void document.exitPictureInPicture().catch(() => {});
    else void video.requestPictureInPicture().catch(() => {});
  }, []);

  /** A caption track on, or null for off. Turning one on names it for a moment. */
  const { choose: chooseCaptions } = captions;
  const showCaptions = useCallback(
    (track: CaptionTrack | null) => {
      chooseCaptions(track);
      if (hintTimer.current) clearTimeout(hintTimer.current);
      setCaptionHint(track ? track.name : null);
      if (track) hintTimer.current = setTimeout(() => setCaptionHint(null), CAPTION_HINT_MS);
    },
    [chooseCaptions],
  );

  /** c and the CC button: captions on or off, in the viewer's language; a note when the video has none. */
  const toggleCaptions = useCallback(() => {
    if (!extras || captions.tracks.length === 0) return flash("No subtitles for this video");
    const track = captions.track ? null : pickTrack(captions.tracks, captions.lang);
    showCaptions(track);
    flash(track ? track.name : "Subtitles off");
  }, [extras, captions.tracks, captions.track, captions.lang, showCaptions, flash]);

  /** + and -: bigger or smaller captions, while they are on. */
  const { style: captionStyle, setStyle: setCaptionStyle } = captions;
  const stepCaptions = useCallback(
    (step: 1 | -1) => {
      if (!captions.track) return;
      const size = stepCaptionSize(captionStyle.size, step);
      setCaptionStyle({ ...captionStyle, size });
      flash(`Font size ${size}%`);
    },
    [captions.track, captionStyle, setCaptionStyle, flash],
  );

  const run = useCallback(
    (action: PlayerAction) => {
      const video = videoRef.current;
      if (!video) return;
      switch (action.type) {
        case "toggle-play":
          return togglePlay();
        case "seek-by":
          return seekTo(video.currentTime + action.seconds);
        case "seek-percent": {
          const d = Number.isFinite(video.duration) ? video.duration : duration;
          return seekTo((d * action.percent) / 100);
        }
        case "volume-by":
          if (video.muted && action.delta > 0) video.muted = false;
          video.volume = stepVolume(video.volume, action.delta);
          return flash(`${Math.round((video.muted ? 0 : video.volume) * 100)}%`);
        case "toggle-mute":
          video.muted = !video.muted;
          return flash(video.muted ? "Muted" : `${Math.round(video.volume * 100)}%`);
        case "fullscreen":
          return toggleFullscreen();
        case "theater":
          return embed ? undefined : toggleTheater();
        case "pip":
          return togglePip();
        case "captions":
          return toggleCaptions();
        case "caption-size":
          return stepCaptions(action.step);
        case "speed-step": {
          const r = stepSpeed(video.playbackRate, action.step, SPEEDS);
          video.playbackRate = r;
          return flash(`${r}x`);
        }
        case "frame-step":
          // Like the 2020 player: frames only step while the video is paused.
          if (!video.paused) return;
          return seekTo(video.currentTime + action.step * FRAME_S);
        case "seek-edge": {
          const d = Number.isFinite(video.duration) ? video.duration : duration;
          return seekTo(action.edge === "start" ? 0 : d);
        }
      }
    },
    [duration, embed, flash, seekTo, stepCaptions, toggleCaptions, toggleFullscreen, togglePip, togglePlay, toggleTheater],
  );

  // Keyboard shortcuts, page wide like YouTube, but never while typing or in a dialog.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest?.('[role="dialog"]')) return;
      const action = keyAction({
        key: e.key,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
        altKey: e.altKey,
        targetTag: target?.tagName,
        targetEditable: target?.isContentEditable,
      }, moreKeys);
      if (!action) return;
      e.preventDefault();
      run(action);
      poke();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [run, poke, moreKeys]);

  // Timestamps in the description and comments jump this player (player extras).
  useEffect(() => {
    if (embed) return;
    setPlayerVideo(videoId);
    return () => clearPlayerVideo(videoId);
  }, [embed, videoId, setPlayerVideo, clearPlayerVideo]);

  useEffect(() => {
    if (!seekRequest || seekRequest.n === handledSeek.current) return;
    handledSeek.current = seekRequest.n;
    const video = videoRef.current;
    if (embed || seekRequest.videoId !== videoId || !video) return;
    seekTo(seekRequest.t);
    video.play().catch(() => {});
    poke();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [seekRequest, embed, videoId, seekTo, poke]);

  useEffect(() => {
    menuOpen.current = menu !== null;
  }, [menu]);

  useEffect(
    () => () => {
      if (tapTimer.current) clearTimeout(tapTimer.current);
    },
    [],
  );

  const closeCtxMenu = useCallback(() => setCtxMenu(null), []);

  useEffect(() => syncAutoplay(), [syncAutoplay]);
  // Autoplay switched off during the countdown: the wall shows instead.
  const ending = endState === "countdown" && !autoplay ? (wall.length ? "wall" : null) : endState;
  const playNext = useCallback(() => {
    if (next) router.push(`/watch?v=${encodeURIComponent(next.id)}`);
  }, [next, router]);
  const cancelAutoplay = useCallback(() => setEnding(wall.length ? "wall" : null), [wall.length]);

  /** Right-click: the player menu. A second right-click while it is open shows the browser's own menu. */
  const onContextMenu = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (!extras) return;
    if (ctxMenu) {
      setCtxMenu(null);
      return;
    }
    const wrap = wrapRef.current;
    if (!wrap) return;
    e.preventDefault();
    const rect = wrap.getBoundingClientRect();
    setMenu(null);
    setCtxMenu(menuPosition(e.clientX - rect.left, e.clientY - rect.top, rect.width, rect.height));
  };

  const copyLink = useCallback(
    (atS: number) => {
      const url = watchLink(window.location.origin, videoId, atS);
      if (!navigator.clipboard?.writeText) return flash("Could not copy the link");
      navigator.clipboard.writeText(url).then(
        () => flash("Link copied"),
        () => flash("Could not copy the link"),
      );
    },
    [videoId, flash],
  );

  /**
   * A finger on the video (player extras): two quick taps on the left half go
   * back 10 seconds, on the right half forward, and each tap after that adds
   * 10 more. A single tap still plays or pauses, a moment later.
   */
  const onVideoPointerUp = (e: ReactPointerEvent<HTMLVideoElement>) => {
    if (!extras || e.pointerType !== "touch") return;
    const video = e.currentTarget;
    const rect = video.getBoundingClientRect();
    const side = tapSide(e.clientX - rect.left, rect.width);
    const { state, skip } = nextTap(tapRef.current, performance.now(), side);
    tapRef.current = state;
    if (tapTimer.current) clearTimeout(tapTimer.current);
    if (skip === 0) {
      tapTimer.current = setTimeout(() => {
        tapRef.current = null;
        if (menuOpen.current) setMenu(null);
        else togglePlay();
      }, DOUBLE_TAP_MS);
      return;
    }
    seekTo(video.currentTime + skip);
    setTapNote({ side, total: tapTotal(state.count), key: state.at });
    poke();
    tapTimer.current = setTimeout(() => {
      tapRef.current = null;
      setTapNote(null);
    }, DOUBLE_TAP_MS + 500);
  };

  // Close the settings menu on a click anywhere else.
  useEffect(() => {
    if (!menu) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t) || gearRef.current?.contains(t)) return;
      setMenu(null);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [menu]);

  const pickQuality = (opt: QualityOption) => {
    setChosen(opt.level);
    saveQuality(opt.label);
    const hls = hlsRef.current;
    const video = videoRef.current;
    if (hls) hls.currentLevel = opt.level;
    else if (native && video && src) {
      const url = opt.level === AUTO ? new URL(src, window.location.href).toString() : variantsRef.current[opt.level]?.uri;
      if (url) swapSource(video, url);
      if (opt.level !== AUTO) setPlayingLevel(opt.level);
    }
    setMenu(null);
  };

  const pickSpeed = (r: number) => {
    if (videoRef.current) videoRef.current.playbackRate = r;
    setMenu(null);
  };

  // Progress bar and volume slider ----------------------------------------------------

  const timeAtPointer = (clientX: number) => {
    const bar = barRef.current;
    if (!bar || !(duration > 0)) return null;
    const rect = bar.getBoundingClientRect();
    const x = Math.min(rect.width, Math.max(0, clientX - rect.left));
    return { x, t: (x / rect.width) * duration, w: rect.width };
  };

  const onBarMove = (e: ReactPointerEvent) => {
    const at = timeAtPointer(e.clientX);
    setHover(at);
    if (scrubbing && at) seekTo(at.t);
  };

  const onBarDown = (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    const at = timeAtPointer(e.clientX);
    if (!at) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setScrubbing(true);
    seekTo(at.t);
  };

  const onBarUp = (e: ReactPointerEvent) => {
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
    setScrubbing(false);
  };

  const setVolumeAt = (clientX: number) => {
    const el = volumeRef.current;
    const video = videoRef.current;
    if (!el || !video) return;
    const rect = el.getBoundingClientRect();
    const v = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    video.volume = Math.round(v * 100) / 100;
    video.muted = v === 0;
  };

  // Rendering -------------------------------------------------------------------------

  const summary = qualitySummary(options, chosen, playingLevel);
  const captionTrack = extras ? captions.track : null;
  const shownCues = captionTrack ? activeCues(captions.cues, time) : [];
  const playingOpt = options.find((o) => o.level === (chosen === AUTO ? playingLevel : chosen));
  const hd = playingOpt?.hd ?? false;
  const showChrome = !playing || active || menu !== null || scrubbing || volumeDrag;
  const shownVolume = muted ? 0 : volume;
  const VolumeIcon = muted || volume === 0 ? VolumeOffIcon : volume < 0.5 ? VolumeDownIcon : VolumeUpIcon;
  const pct = (n: number) => (duration > 0 ? `${Math.min(100, (n / duration) * 100)}%` : "0%");
  const cue = hover && cues.length ? cueAt(cues, hover.t) : null;
  const hoverChapter = hover && chapters.length ? chapters[chapterAt(chapters, hover.t)] : null;
  const currentChapter = chapters.length ? chapters[chapterAt(chapters, time)] : null;
  const tipHalf = Math.max(cue ? cue.w + 4 : 0, 48, hoverChapter ? 160 : 0) / 2;
  const tipLeft = hover ? Math.min(Math.max(hover.x, tipHalf), Math.max(tipHalf, hover.w - tipHalf)) : 0;
  // The encoder cuts 160 x 90 tiles, so a frame is shown at its own size.
  const sprite = cue
    ? { backgroundImage: `url("${cue.url}")`, backgroundPosition: `-${cue.x}px -${cue.y}px`, width: cue.w, height: cue.h }
    : undefined;

  return (
    <div
      ref={wrapRef}
      data-player
      data-player-state={ended ? "ended" : playing ? "playing" : "paused"}
      data-quality={summary}
      data-level={playingLevel}
      data-native={native ? "1" : undefined}
      onPointerMove={poke}
      onPointerLeave={() => playing && setActive(false)}
      onContextMenu={onContextMenu}
      className={`group/player relative h-full w-full select-none overflow-hidden bg-black text-white ${
        showChrome ? "" : "cursor-none"
      }`}
    >
      <video
        ref={videoRef}
        poster={poster ?? undefined}
        playsInline
        preload="metadata"
        loop={loop}
        className={`absolute inset-0 h-full w-full object-contain ${extras ? "touch-manipulation" : ""}`}
        onPointerDown={(e) => {
          pointerType.current = e.pointerType;
        }}
        onPointerUp={onVideoPointerUp}
        onClick={() => {
          // With player extras a finger's taps are handled on pointer up.
          if (extras && pointerType.current === "touch") return;
          if (menu) setMenu(null);
          else togglePlay();
        }}
        onDoubleClick={() => {
          if (extras && pointerType.current === "touch") return;
          toggleFullscreen();
        }}
        onPlay={() => {
          setPlaying(true);
          setStarted(true);
          setEnded(false);
          setEnding(null);
          poke();
        }}
        onSeeking={() => setEnding(null)}
        onPause={(e) => {
          setPlaying(false);
          saveResume(videoId, e.currentTarget.currentTime, e.currentTarget.duration);
        }}
        onEnded={(e) => {
          setPlaying(false);
          setEnded(true);
          saveResume(videoId, e.currentTarget.duration, e.currentTarget.duration);
          // A playlist goes on to its next video, like 2020, whatever autoplay says.
          if (listNext && !embed) {
            router.push(listNext);
            return;
          }
          if (extras && !embed) setEnding(endChoice(autoplay, next !== null, wall.length));
        }}
        onWaiting={() => setWaiting(true)}
        onPlaying={() => setWaiting(false)}
        onCanPlay={() => setWaiting(false)}
        onTimeUpdate={(e) => {
          const v = e.currentTarget;
          setTime(v.currentTime);
          setStoreTime(v.currentTime);
          if (!onAir && Math.abs(v.currentTime - lastSaved.current) >= RESUME_EVERY_S) {
            lastSaved.current = v.currentTime;
            saveResume(videoId, v.currentTime, v.duration);
          }
        }}
        onDurationChange={(e) => {
          if (Number.isFinite(e.currentTarget.duration)) setDuration(e.currentTarget.duration);
        }}
        onProgress={(e) => {
          const v = e.currentTarget;
          const b = v.buffered;
          for (let i = 0; i < b.length; i++) {
            if (b.start(i) <= v.currentTime + 0.5 && b.end(i) >= v.currentTime) return setBuffered(b.end(i));
          }
          if (b.length) setBuffered(b.end(b.length - 1));
        }}
        onVolumeChange={(e) => {
          setVolume(e.currentTarget.volume);
          setMuted(e.currentTarget.muted);
          saveVolume(e.currentTarget.volume, e.currentTarget.muted);
        }}
        onRateChange={(e) => setRate(e.currentTarget.playbackRate)}
      />

      {!src && !error && (
        <div className="pointer-events-none absolute inset-x-0 top-0 bg-gradient-to-b from-black/70 to-transparent p-4 text-[13px] text-[#eeeeee]">
          Preview without media. Set MEDIA_PUBLIC_URL to play the sample clip.
        </div>
      )}

      {error && (
        <div className="absolute inset-0 grid place-items-center bg-black p-6 text-center text-[16px]">{error}</div>
      )}

      {resumed && !error && (
        <div
          role="status"
          data-resumed
          className="pointer-events-none absolute left-3 top-3 rounded-sm bg-black/80 px-3 py-1.5 text-[13px] font-medium text-white"
        >
          Resumed
        </div>
      )}

      {note && !error && (
        <div
          aria-hidden
          data-player-note
          className="pointer-events-none absolute left-1/2 top-[12%] -translate-x-1/2 rounded-sm bg-black/70 px-4 py-2 text-[15px] font-medium text-white"
        >
          {note}
        </div>
      )}
      <div role="status" aria-live="polite" className="sr-only">
        {note ?? ""}
      </div>

      {waiting && playing && (
        <div className="pointer-events-none absolute left-1/2 top-1/2 h-16 w-16 -translate-x-1/2 -translate-y-1/2 animate-spin rounded-full border-4 border-white/30 border-t-white" />
      )}

      {/* The big play button, while paused. */}
      {!playing && !error && !scrubbing && ending === null && (
        <button
          type="button"
          aria-label={ended ? "Replay" : "Play"}
          data-big-play
          onClick={togglePlay}
          disabled={!src}
          className="group/big absolute left-1/2 top-1/2 h-16 w-16 -translate-x-1/2 -translate-y-1/2 disabled:cursor-default"
        >
          {/* A round button in the brand green (lib/brand.ts), our own shape. */}
          <svg viewBox="0 0 64 64" className="h-full w-full drop-shadow-[0_1px_3px_rgba(0,0,0,0.4)]" aria-hidden>
            <circle
              cx="32"
              cy="32"
              r="30"
              className={`transition-colors ${started ? "fill-[#212121] opacity-80 group-hover/big:fill-[var(--mark)] group-hover/big:opacity-100" : "fill-[var(--mark)]"}`}
            />
            {ended ? (
              <path d="M32 21v-5l-6.5 6.5L32 29v-5c4.14 0 7.5 3.36 7.5 7.5S36.14 39 32 39s-7.5-3.36-7.5-7.5h-3c0 5.8 4.7 10.5 10.5 10.5S42.5 37.3 42.5 31.5 37.8 21 32 21z" fill="#fff" />
            ) : (
              <path d="M26 20.5v23L44 32z" fill="#fff" strokeLinejoin="round" />
            )}
          </svg>
        </button>
      )}

      {ending === "countdown" && next && (
        <AutoplayCountdown video={next} channelName={channelName} onPlay={playNext} onCancel={cancelAutoplay} />
      )}
      {ending === "wall" && <EndScreenWall videos={wall} channelName={channelName} />}

      <VideoCards cards={cards} time={time} chrome={showChrome} hidden={ending !== null || Boolean(error)} />

      {watermark && !embed && (
        <Watermark watermark={watermark} time={time} duration={duration} raised={showChrome} hidden={ending !== null || Boolean(error) || !started} />
      )}

      {paidPromotion && ending === null && !error && time < PAID_PROMOTION_S && (
        <div
          data-paid-promotion
          className="pp-fade-in pointer-events-none absolute left-3 top-3 z-10 flex items-center gap-1.5 rounded-[2px] bg-black/60 px-2 py-1 text-[13px] font-medium text-white"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden>
            <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z" fill="currentColor" />
          </svg>
          Includes paid promotion
        </div>
      )}

      {captionTrack && ending === null && !error && (
        <CaptionOverlay
          cues={shownCues}
          hint={captionHint}
          style={captions.style}
          playerHeight={playerH}
          raised={showChrome}
        />
      )}

      {/* The bottom chrome. */}
      <div
        className={`absolute inset-x-0 bottom-0 transition-opacity duration-200 ${
          showChrome ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      >
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[98px] bg-gradient-to-t from-black/70 via-black/25 to-transparent" />

        {/* Hover preview: the sprite frame and the time. */}
        {hover && (
          <div
            data-hover-preview
            className="pointer-events-none absolute bottom-[52px] z-10 flex -translate-x-1/2 flex-col items-center"
            style={{ left: 12 + tipLeft }}
          >
            {sprite && <div data-sprite-frame className="box-content border-2 border-white bg-black bg-no-repeat" style={sprite} />}
            {hoverChapter && (
              <span
                data-hover-chapter
                className="mt-1 max-w-[160px] truncate text-[12px] font-medium [text-shadow:0_0_4px_rgba(0,0,0,.75)]"
              >
                {hoverChapter.title}
              </span>
            )}
            <span className="mt-1 text-[13px] font-medium [text-shadow:0_0_4px_rgba(0,0,0,.75)]">
              {formatTime(hover.t)}
            </span>
          </div>
        )}

        {/* The progress bar: a 3 px line that grows to 5 px under the mouse. */}
        <div
          ref={barRef}
          role="slider"
          aria-label="Seek slider"
          aria-valuemin={0}
          aria-valuemax={Math.floor(duration)}
          aria-valuenow={Math.floor(time)}
          aria-valuetext={`${formatTime(time)} of ${formatTime(duration)}`}
          tabIndex={-1}
          data-progress
          onPointerMove={onBarMove}
          onPointerLeave={() => !scrubbing && setHover(null)}
          onPointerDown={onBarDown}
          onPointerUp={onBarUp}
          className="group/bar absolute inset-x-3 bottom-9 h-[17px] cursor-pointer touch-none"
        >
          {chapters.length > 0 ? (
            <ChapterTrack
              chapters={chapters}
              duration={duration}
              time={time}
              buffered={buffered}
              hoverT={hover ? hover.t : null}
              scrubbing={scrubbing}
            />
          ) : (
            <div
              className={`absolute inset-x-0 bottom-[7px] h-[3px] origin-bottom bg-white/20 transition-transform group-hover/bar:scale-y-[1.67] ${
                scrubbing ? "scale-y-[1.67]" : ""
              }`}
            >
              <div className="absolute inset-y-0 left-0 bg-white/40" style={{ width: pct(buffered) }} />
              {hover && <div className="absolute inset-y-0 left-0 bg-white/50" style={{ width: pct(hover.t) }} />}
              <div className="absolute inset-y-0 left-0 bg-[var(--mark)]" style={{ width: pct(time) }} />
            </div>
          )}
          <div
            className={`absolute bottom-[3px] h-[13px] w-[13px] -translate-x-1/2 rounded-full bg-[var(--mark)] transition-transform ${
              scrubbing ? "scale-100" : "scale-0 group-hover/bar:scale-100"
            }`}
            style={{ left: pct(time) }}
          />
        </div>

        {/* The bottom bar. */}
        <div className="relative flex h-9 items-center px-3 text-[#eeeeee]">
          <CtrlButton label={playing ? "Pause (k)" : ended ? "Replay" : "Play (k)"} onClick={togglePlay} data-play>
            {playing ? <PauseIcon className="h-7 w-7" /> : ended ? <ReplayIcon className="h-6 w-6" /> : <PlayIcon className="h-7 w-7" />}
          </CtrlButton>

          <div className="group/vol flex items-center">
            <CtrlButton
              label={muted ? "Unmute (m)" : "Mute (m)"}
              onClick={() => {
                const v = videoRef.current;
                if (v) v.muted = !v.muted;
              }}
              data-mute
            >
              <VolumeIcon className="h-6 w-6" />
            </CtrlButton>
            <div
              className={`overflow-hidden transition-[width] duration-200 group-hover/vol:w-[60px] group-focus-within/vol:w-[60px] ${
                volumeDrag ? "w-[60px]" : "w-0"
              }`}
            >
              <div
                ref={volumeRef}
                role="slider"
                aria-label="Volume"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(shownVolume * 100)}
                tabIndex={0}
                data-volume
                onPointerDown={(e) => {
                  e.currentTarget.setPointerCapture(e.pointerId);
                  setVolumeDrag(true);
                  setVolumeAt(e.clientX);
                }}
                onPointerMove={(e) => volumeDrag && setVolumeAt(e.clientX)}
                onPointerUp={() => setVolumeDrag(false)}
                className="relative mx-1.5 h-9 w-[52px] cursor-pointer touch-none"
              >
                <div className="absolute inset-x-0 top-1/2 h-[3px] -translate-y-1/2 bg-white/20">
                  <div className="h-full bg-white" style={{ width: `${shownVolume * 100}%` }} />
                </div>
                <div
                  className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white"
                  style={{ left: `${shownVolume * 100}%` }}
                />
              </div>
            </div>
          </div>

          {onAir ? (
            <button
              type="button"
              data-live-edge={atLiveEdge(time, duration, 12) ? "on" : "behind"}
              onClick={goLive}
              title={atLiveEdge(time, duration, 12) ? "You're watching live" : "Skip ahead to live broadcast"}
              className="flex items-center gap-1.5 whitespace-nowrap px-2 text-[13px] font-medium uppercase leading-9 [text-shadow:0_0_2px_rgba(0,0,0,.5)]"
            >
              <span
                aria-hidden
                className={`h-2 w-2 rounded-full ${atLiveEdge(time, duration, 12) ? "bg-[#ff0000]" : "bg-[#909090]"}`}
              />
              {t("Live")}
            </button>
          ) : (
            <span data-time className="whitespace-nowrap px-2 text-[13px] leading-9 [text-shadow:0_0_2px_rgba(0,0,0,.5)]">
              {formatTime(time)} / {formatTime(duration)}
            </span>
          )}
          {currentChapter && (
            <span
              data-chapter-title
              className="min-w-0 truncate pr-2 text-[13px] leading-9 [text-shadow:0_0_2px_rgba(0,0,0,.5)] max-sm:hidden"
            >
              <span aria-hidden className="pr-1.5">
                {"\u2022"}
              </span>
              {currentChapter.title}
            </span>
          )}

          <div className="ml-auto flex items-center">
            {extras && (
              <CtrlButton
                label={captions.tracks.length ? "Subtitles/closed captions (c)" : "Subtitles/closed captions unavailable"}
                onClick={toggleCaptions}
                aria-pressed={captionTrack !== null}
                data-captions-button={captionTrack ? "on" : captions.tracks.length ? "off" : "none"}
              >
                <SubtitlesIcon className={`h-6 w-6 ${captions.tracks.length ? "" : "opacity-50"}`} />
                {captionTrack && (
                  <span aria-hidden className="absolute bottom-[5px] left-1/2 h-[3px] w-[22px] -translate-x-1/2 rounded-[1px] bg-[var(--mark)]" />
                )}
              </CtrlButton>
            )}
            <div className="relative">
              <CtrlButton
                ref={gearRef}
                label="Settings"
                onClick={() => setMenu(menu ? null : "main")}
                data-settings
                aria-expanded={menu !== null}
              >
                <SettingsIcon className={`h-6 w-6 transition-transform duration-200 ${menu ? "rotate-[30deg]" : ""}`} />
                {hd && (
                  <span className="absolute right-[6px] top-[5px] rounded-[1px] bg-[var(--mark)] px-[2px] text-[8px] font-bold leading-[10px] text-white">
                    HD
                  </span>
                )}
              </CtrlButton>
            </div>
            {!embed && (
              <CtrlButton
                label={theater ? "Default view (t)" : "Theater mode (t)"}
                onClick={toggleTheater}
                className="max-[1015px]:hidden"
                data-theater
              >
                {theater ? <DefaultViewIcon className="h-6 w-6" /> : <TheaterIcon className="h-6 w-6" />}
              </CtrlButton>
            )}
            {pipOk && (
              // Phones have no room for it next to CC (and their browsers offer it themselves).
              <CtrlButton label="Picture in picture (i)" onClick={togglePip} className={extras ? "max-sm:hidden" : ""} data-pip>
                <PipIcon className="h-[22px] w-[22px]" />
              </CtrlButton>
            )}
            <CtrlButton label={fullscreen ? "Exit full screen (f)" : "Full screen (f)"} onClick={toggleFullscreen} data-fullscreen>
              {fullscreen ? <FullscreenExitIcon className="h-7 w-7" /> : <FullscreenIcon className="h-7 w-7" />}
            </CtrlButton>
          </div>
        </div>
      </div>

      {/* The settings menu. */}
      {menu && (
        <div
          ref={menuRef}
          role="menu"
          data-settings-menu={menu}
          className="absolute bottom-[49px] right-3 z-20 min-w-[251px] overflow-y-auto rounded-[2px] bg-[rgba(28,28,28,0.9)] py-2 text-[13px] font-medium text-[#eeeeee] [text-shadow:0_0_2px_rgba(0,0,0,.5)]"
          style={playerH > 0 ? { maxHeight: Math.max(140, playerH - 60) } : undefined}
        >
          {menu === "main" && (
            <>
              <MenuRow onClick={() => setMenu("speed")} label="Playback speed" value={speedLabel(rate)} />
              {extras && captions.tracks.length > 0 && (
                <MenuRow
                  onClick={() => setMenu("subtitles")}
                  label={`Subtitles/CC (${captions.tracks.length})`}
                  value={captionTrack ? captionTrack.name : "Off"}
                  data-menu-subtitles
                />
              )}
              <MenuRow onClick={() => setMenu("quality")} label="Quality" value={summary} />
            </>
          )}
          {menu === "subtitles" && (
            <>
              <MenuBack
                onClick={() => setMenu("main")}
                label="Subtitles/CC"
                extra={
                  <button
                    type="button"
                    onClick={() => setMenu("caption-options")}
                    data-caption-options
                    className="ml-auto h-full px-3 text-[13px] font-medium hover:bg-white/10"
                  >
                    Options
                  </button>
                }
              />
              <MenuChoice
                checked={captionTrack === null}
                onClick={() => {
                  showCaptions(null);
                  setMenu(null);
                }}
                data-caption-track="off"
              >
                Off
              </MenuChoice>
              {captions.tracks.map((t) => (
                <MenuChoice
                  key={t.id}
                  checked={captionTrack?.id === t.id}
                  onClick={() => {
                    showCaptions(t);
                    setMenu(null);
                  }}
                  data-caption-track={t.lang || t.name}
                >
                  {t.name}
                </MenuChoice>
              ))}
            </>
          )}
          {menu === "caption-options" && (
            <>
              <MenuBack onClick={() => setMenu("subtitles")} label="Options" />
              {CAPTION_SETTINGS.map(({ key, label }) => (
                <MenuRow
                  key={key}
                  onClick={() => setMenu(`caption-${key}`)}
                  label={label}
                  value={captionValueLabel(captions.style, key)}
                  data-caption-setting={key}
                />
              ))}
              <button
                type="button"
                role="menuitem"
                onClick={() => captions.setStyle(DEFAULT_CAPTION_STYLE)}
                data-caption-reset
                className="flex h-10 w-full items-center px-4 hover:bg-white/10"
              >
                Reset
              </button>
            </>
          )}
          {menu?.startsWith("caption-") && menu !== "caption-options" && (() => {
            const key = menu.slice("caption-".length) as CaptionSetting;
            const setting = CAPTION_SETTINGS.find((c) => c.key === key);
            if (!setting) return null;
            return (
              <>
                <MenuBack onClick={() => setMenu("caption-options")} label={setting.label} />
                {captionChoices(key).map((c) => (
                  <MenuChoice
                    key={c.value}
                    checked={captions.style[key] === c.value}
                    onClick={() => {
                      captions.setStyle(setCaptionSetting(captions.style, key, c.value));
                      setMenu("caption-options");
                    }}
                    data-caption-choice={c.value}
                  >
                    {c.label}
                  </MenuChoice>
                ))}
              </>
            );
          })()}
          {menu === "speed" && (
            <>
              <MenuBack onClick={() => setMenu("main")} label="Playback speed" />
              <div className="max-h-[260px] overflow-y-auto">
                {SPEEDS.map((r) => (
                  <MenuChoice key={r} checked={rate === r} onClick={() => pickSpeed(r)}>
                    {speedLabel(r)}
                  </MenuChoice>
                ))}
              </div>
            </>
          )}
          {menu === "quality" && (
            <>
              <MenuBack onClick={() => setMenu("main")} label="Quality" />
              {options.map((o) => (
                <MenuChoice key={o.level} checked={chosen === o.level} onClick={() => pickQuality(o)} data-quality-option={o.label}>
                  {o.level === AUTO && chosen === AUTO && playingOpt ? `Auto (${playingOpt.label})` : o.label}
                  {o.hd && <sup className="ml-0.5 text-[9px] font-bold text-[var(--mark)]">HD</sup>}
                </MenuChoice>
              ))}
              {hdPending && (
                <p data-hd-pending className="mt-1 border-t border-white/20 px-4 pb-1 pt-3 text-[13px] font-normal leading-[18px] text-white/70">
                  {t("HD is still processing. Check back later for higher quality.")}
                </p>
              )}
            </>
          )}
        </div>
      )}

      {/* Double tap to skip (player extras). */}
      {tapNote && (
        <div
          key={tapNote.key}
          aria-hidden
          data-tap-skip={tapNote.side}
          className={`pointer-events-none absolute inset-y-0 flex w-2/5 flex-col items-center justify-center bg-white/10 text-white [text-shadow:0_0_4px_rgba(0,0,0,.75)] ${
            tapNote.side === "back" ? "left-0 rounded-r-[50%]" : "right-0 rounded-l-[50%]"
          }`}
        >
          <span className={`flex ${tapNote.side === "back" ? "-scale-x-100" : ""}`}>
            {[0, 1, 2].map((i) => (
              <svg key={i} viewBox="0 0 24 24" className="-mx-1 h-5 w-5 drop-shadow-[0_0_3px_rgba(0,0,0,.75)]" aria-hidden>
                <path d="M8 5v14l11-7z" fill="currentColor" />
              </svg>
            ))}
          </span>
          <span className="mt-1 text-[13px] font-medium">{tapNote.total} seconds</span>
        </div>
      )}

      {ctxMenu && (
        <PlayerContextMenu
          left={ctxMenu.left}
          top={ctxMenu.top}
          loop={loop}
          onLoop={() => setLoop((on) => !on)}
          onCopy={() => copyLink(0)}
          onCopyAtTime={() => copyLink(videoRef.current?.currentTime ?? 0)}
          onStats={() => setNerds(true)}
          onClose={closeCtxMenu}
        />
      )}

      {nerds && (
        <StatsForNerds
          videoId={videoId}
          videoRef={videoRef}
          hlsRef={hlsRef}
          engine={engine || "loading"}
          quality={summary}
          playingLevel={playingLevel}
          onClose={() => setNerds(false)}
        />
      )}
    </div>
  );
}

function CtrlButton({
  label,
  children,
  className = "",
  ref,
  ...rest
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
  ref?: React.Ref<HTMLButtonElement>;
  onClick?: () => void;
  "aria-expanded"?: boolean;
  "aria-pressed"?: boolean;
} & Record<`data-${string}`, unknown>) {
  const t = useT();
  return (
    <button
      ref={ref}
      type="button"
      title={t(label)}
      aria-label={t(label)}
      className={`relative grid h-9 w-[46px] shrink-0 place-items-center opacity-90 hover:opacity-100 ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

function MenuRow({
  label,
  value,
  onClick,
  ...rest
}: { label: string; value: string; onClick: () => void } & Record<`data-${string}`, unknown>) {
  const t = useT();
  return (
    <button type="button" role="menuitem" onClick={onClick} className="flex h-10 w-full items-center px-4 hover:bg-white/10" {...rest}>
      <span className="mr-6 flex-1 text-left">{t(label)}</span>
      <span className="text-right font-normal">{t(value)}</span>
      <ChevronRightIcon className="-mr-1.5 ml-1 h-5 w-5" />
    </button>
  );
}

function MenuBack({ label, onClick, extra = null }: { label: string; onClick: () => void; extra?: React.ReactNode }) {
  const t = useT();
  const back = (
    <button
      type="button"
      onClick={onClick}
      className={`flex h-12 items-center px-2 text-[15px] hover:bg-white/10 ${extra ? "" : "w-full"}`}
    >
      <ChevronLeftIcon className="mr-2 h-6 w-6" />
      {t(label)}
    </button>
  );
  // With something on the right (Options, in Subtitles/CC) the header is a row of two buttons.
  return <div className="mb-2 flex h-12 items-center border-b border-white/20">{back}{extra}</div>;
}

function MenuChoice({
  checked,
  onClick,
  children,
  ...rest
}: { checked: boolean; onClick: () => void; children: React.ReactNode } & Record<`data-${string}`, unknown>) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={checked}
      onClick={onClick}
      className="flex h-10 w-full items-center pl-2 pr-6 hover:bg-white/10"
      {...rest}
    >
      <span className="grid w-8 place-items-center">{checked && <CheckIcon className="h-5 w-5" />}</span>
      <span>{children}</span>
    </button>
  );
}
