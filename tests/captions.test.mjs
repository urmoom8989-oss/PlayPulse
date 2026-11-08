// Captions in the player (player extras): the tracks in the master playlist,
// the WebVTT cues, the viewer's style and what the browser remembers.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  activeCues,
  CAPTION_SETTINGS,
  captionChoices,
  captionCss,
  captionPrefsText,
  captionValueLabel,
  cueText,
  DEFAULT_CAPTION_PREFS,
  DEFAULT_CAPTION_STYLE,
  hlsAttributes,
  normalizeCaptionStyle,
  parseCaptionPrefs,
  parseCaptionVtt,
  parseSubtitleTracks,
  pickTrack,
  setCaptionSetting,
  stepCaptionSize,
  subtitleSegments,
} from "../lib/watch/captions.ts";
import { keyAction } from "../lib/watch/keys.ts";
import { cleanMediaPath } from "../lib/watch/media.ts";
import { rewritePlaylist } from "../lib/watch/playlist.ts";

const VIDEO = "aaaaaaaa-bbbb-cccc-dddd-000000000001";

/** master.m3u8 as the encoder writes it once the captions are in (worker/lib/captions.mjs). */
const MASTER = [
  "#EXTM3U",
  "#EXT-X-VERSION:7",
  '#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="English (auto-generated)",LANGUAGE="en",DEFAULT=NO,AUTOSELECT=NO,FORCED=NO,URI="captions/en.m3u8"',
  '#EXT-X-STREAM-INF:BANDWIDTH=1100000,RESOLUTION=640x360,CODECS="avc1.64001e,mp4a.40.2",SUBTITLES="subs"',
  "360p/index.m3u8",
  "",
].join("\n");

const SUBTITLE_PLAYLIST = "#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:84\n#EXT-X-MEDIA-SEQUENCE:0\n#EXT-X-PLAYLIST-TYPE:VOD\n#EXTINF:83.250,\nen.vtt\n#EXT-X-ENDLIST\n";

test("captions: HLS attributes, quoted values with commas included", () => {
  assert.deepEqual(hlsAttributes('#EXT-X-STREAM-INF:BANDWIDTH=1,CODECS="avc1,mp4a",SUBTITLES="subs"'), {
    BANDWIDTH: "1",
    CODECS: "avc1,mp4a",
    SUBTITLES: "subs",
  });
});

test("captions: the media route's master playlist lists the track at its route URL", () => {
  // The route rewrites every URI in the playlist (lib/watch/playlist.ts) ...
  const served = rewritePlaylist(MASTER, "master.m3u8", `/api/media/${VIDEO}`);
  const masterUrl = `https://tube.example.test/api/media/${VIDEO}/master.m3u8`;
  const tracks = parseSubtitleTracks(served, masterUrl);
  assert.deepEqual(tracks, [
    { id: `https://tube.example.test/api/media/${VIDEO}/captions/en.m3u8`, lang: "en", name: "English (auto-generated)" },
  ]);
  // ... and the subtitle playlist's file, relative to captions/.
  const playlist = rewritePlaylist(SUBTITLE_PLAYLIST, "captions/en.m3u8", `/api/media/${VIDEO}`);
  assert.deepEqual(subtitleSegments(playlist, tracks[0].id), [`https://tube.example.test/api/media/${VIDEO}/captions/en.vtt`]);
  // Both files pass the route's path check.
  assert.deepEqual(cleanMediaPath(["captions", "en.m3u8"]), { path: "captions/en.m3u8", ext: "m3u8" });
  assert.deepEqual(cleanMediaPath(["captions", "en.vtt"]), { path: "captions/en.vtt", ext: "vtt" });
});

test("captions: tracks without subtitles, audio renditions and duplicates are left out", () => {
  assert.deepEqual(parseSubtitleTracks("#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\n360p/index.m3u8\n", "https://x.test/m.m3u8"), []);
  const text = [
    '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",NAME="Main",URI="audio.m3u8"',
    '#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="s",NAME="Deutsch",LANGUAGE="de",URI="de.m3u8"',
    '#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="s",NAME="Deutsch again",LANGUAGE="de",URI="de.m3u8"',
    '#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="s",LANGUAGE="fr",URI="fr.m3u8"',
    '#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="s",NAME="No file"',
  ].join("\n");
  assert.deepEqual(parseSubtitleTracks(text, "https://x.test/v/master.m3u8"), [
    { id: "https://x.test/v/de.m3u8", lang: "de", name: "Deutsch" },
    { id: "https://x.test/v/fr.m3u8", lang: "fr", name: "fr" },
  ]);
  // A plain .vtt is its own file.
  assert.deepEqual(subtitleSegments("WEBVTT\n\n00:01.000 --> 00:02.000\nhi\n", "https://x.test/a.vtt"), ["https://x.test/a.vtt"]);
});

test("captions: the encoder's WebVTT, and other people's", () => {
  const vtt = "WEBVTT\n\n00:00:00.500 --> 00:00:03.000\nTom &amp; Jerry\n\n00:01:23.500 --> 01:02:05.250\na &lt;b&gt; tag --&gt;\nsecond line\n";
  assert.deepEqual(parseCaptionVtt(vtt), [
    { start: 0.5, end: 3, text: "Tom & Jerry" },
    { start: 83.5, end: 3725.25, text: "a <b> tag -->\nsecond line" },
  ]);
  const other = [
    "WEBVTT - with a title",
    "",
    "NOTE a comment",
    "",
    "STYLE",
    "::cue { color: lime }",
    "",
    "intro",
    "00:05.000 --> 00:07.000 align:start position:10%",
    "<v Roger><i>Hello</i> <c.yellow>there</c></v>&nbsp;&#x263A;",
    "",
    "00:02.000 --> 00:04.000",
    "earlier, listed later",
    "",
    "00:09.000 --> 00:08.000",
    "ends before it starts",
    "",
    "00:10.000 --> 00:11.000",
    "<b></b>",
  ].join("\r\n");
  assert.deepEqual(parseCaptionVtt(other), [
    { start: 2, end: 4, text: "earlier, listed later" },
    { start: 5, end: 7, text: `Hello there ${String.fromCodePoint(0x263a)}` },
  ]);
  assert.equal(cueText("  one  \n\n  two "), "one\ntwo");
  assert.equal(cueText("&unknown; &#0;"), "&unknown;");
});

test("captions: the cues on screen at a time", () => {
  const cues = [
    { start: 0, end: 2, text: "a" },
    { start: 2, end: 4, text: "b" },
    { start: 3, end: 6, text: "c" },
    { start: 10, end: 12, text: "d" },
  ];
  const at = (t) => activeCues(cues, t).map((c) => c.text);
  assert.deepEqual(at(-1), []);
  assert.deepEqual(at(0), ["a"]);
  assert.deepEqual(at(1.99), ["a"]);
  assert.deepEqual(at(2), ["b"]);
  assert.deepEqual(at(3.5), ["b", "c"]);
  assert.deepEqual(at(7), []);
  assert.deepEqual(at(11), ["d"]);
  assert.deepEqual(at(12), []);
  assert.deepEqual(activeCues([], 1), []);
  assert.deepEqual(activeCues(cues, Number.NaN), []);
});

test("captions: the viewer's language first, else the first track", () => {
  const tracks = [
    { id: "1", lang: "en", name: "English (auto-generated)" },
    { id: "2", lang: "de", name: "German" },
  ];
  assert.equal(pickTrack(tracks, "de").id, "2");
  assert.equal(pickTrack(tracks, "DE").id, "2");
  assert.equal(pickTrack(tracks, "ja").id, "1");
  assert.equal(pickTrack(tracks, null).id, "1");
  assert.equal(pickTrack([], "en"), null);
});

test("captions: every option has its choices and the menu shows the current one", () => {
  assert.deepEqual(
    CAPTION_SETTINGS.map((s) => s.label),
    ["Font family", "Font color", "Font size", "Background color", "Background opacity", "Font opacity", "Character edge style"],
  );
  assert.deepEqual(captionChoices("size").map((c) => c.label), ["50%", "75%", "100%", "150%", "200%", "300%", "400%"]);
  assert.deepEqual(captionChoices("bgOpacity").map((c) => c.value), [0, 25, 50, 75, 100]);
  assert.equal(captionChoices("color").length, 8);
  assert.equal(captionChoices("edge")[1].label, "Drop Shadow");
  const labels = Object.fromEntries(CAPTION_SETTINGS.map(({ key }) => [key, captionValueLabel(DEFAULT_CAPTION_STYLE, key)]));
  assert.deepEqual(labels, {
    font: "Proportional Sans-Serif",
    color: "White",
    size: "100%",
    bg: "Black",
    bgOpacity: "75%",
    fontOpacity: "100%",
    edge: "None",
  });
});

test("captions: a setting changes only to one of its choices", () => {
  const yellow = setCaptionSetting(DEFAULT_CAPTION_STYLE, "color", "yellow");
  assert.equal(yellow.color, "yellow");
  assert.equal(DEFAULT_CAPTION_STYLE.color, "white", "the default is not changed");
  assert.equal(setCaptionSetting(DEFAULT_CAPTION_STYLE, "color", "plaid"), DEFAULT_CAPTION_STYLE);
  assert.equal(setCaptionSetting(DEFAULT_CAPTION_STYLE, "size", 125), DEFAULT_CAPTION_STYLE);
  assert.equal(setCaptionSetting(DEFAULT_CAPTION_STYLE, "size", "200"), DEFAULT_CAPTION_STYLE, "a number setting wants a number");
  assert.deepEqual(normalizeCaptionStyle({ color: "cyan", size: 200, bg: 7, edge: "glow", extra: true }), {
    ...DEFAULT_CAPTION_STYLE,
    color: "cyan",
    size: 200,
  });
  assert.deepEqual(normalizeCaptionStyle(null), DEFAULT_CAPTION_STYLE);
});

test("captions: + and - step through the sizes and stop at the ends", () => {
  assert.equal(stepCaptionSize(100, 1), 150);
  assert.equal(stepCaptionSize(100, -1), 75);
  assert.equal(stepCaptionSize(400, 1), 400);
  assert.equal(stepCaptionSize(50, -1), 50);
  assert.equal(stepCaptionSize(123, 1), 150);
  assert.deepEqual(keyAction({ key: "+" }), { type: "caption-size", step: 1 });
  assert.deepEqual(keyAction({ key: "=" }), { type: "caption-size", step: 1 });
  assert.deepEqual(keyAction({ key: "-" }), { type: "caption-size", step: -1 });
  assert.equal(keyAction({ key: "-", targetTag: "INPUT" }), null);
  assert.equal(keyAction({ key: "+", ctrlKey: true }), null, "Ctrl and + still zooms the page");
});

test("captions: the style follows the player's size", () => {
  const css = captionCss(DEFAULT_CAPTION_STYLE, 480);
  assert.deepEqual(css, {
    fontSize: "21.6px",
    fontFamily: "Roboto, Arial, Helvetica, Verdana, sans-serif",
    fontVariant: "normal",
    color: "rgba(255, 255, 255, 1)",
    backgroundColor: "rgba(8, 8, 8, 0.75)",
    textShadow: "none",
  });
  const big = captionCss({ ...DEFAULT_CAPTION_STYLE, size: 200, bg: "blue", bgOpacity: 0, font: "small-caps", edge: "outline", fontOpacity: 50 }, 1080);
  assert.equal(big.fontSize, "97.2px");
  assert.equal(big.backgroundColor, "rgba(0, 0, 255, 0)");
  assert.equal(big.color, "rgba(255, 255, 255, 0.5)");
  assert.equal(big.fontVariant, "small-caps");
  assert.match(big.textShadow, /^0 0 2px #222/);
  // A tiny or unmeasured player still gets readable words.
  assert.equal(captionCss(DEFAULT_CAPTION_STYLE, 0).fontSize, "10px");
});

test("captions: what the browser remembers, however broken", () => {
  assert.deepEqual(parseCaptionPrefs(null), DEFAULT_CAPTION_PREFS);
  assert.deepEqual(parseCaptionPrefs("{not json"), DEFAULT_CAPTION_PREFS);
  assert.deepEqual(parseCaptionPrefs('{"on":"yes","lang":"<script>","style":{"size":9000}}'), DEFAULT_CAPTION_PREFS);
  const prefs = { on: true, lang: "pt-BR", style: { ...DEFAULT_CAPTION_STYLE, color: "yellow", bgOpacity: 25 } };
  assert.deepEqual(parseCaptionPrefs(captionPrefsText(prefs)), prefs);
});
