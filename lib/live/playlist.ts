// While a Premiere or a live broadcast is on, the media route hands out its
// playlists cut at "now", so the player treats the upload as a live stream:
// it starts at the live edge, can rewind to the start, and asks again for the
// playlist as it grows. When the broadcast ends the full playlist (with
// #EXT-X-ENDLIST) comes back and the player carries on as a normal video.
// No imports, so Node can load this file directly.

/**
 * A media playlist with only the segments that ended by `elapsedS` seconds
 * into the broadcast (always at least the first one), as an EVENT playlist
 * without #EXT-X-ENDLIST. Header lines (version, target duration, the init
 * segment's #EXT-X-MAP) stay as they are.
 */
export function truncateMediaPlaylist(text: string, elapsedS: number): string {
  const lines = text.split(/\r?\n/);
  const out: string[] = [];
  let pending: string[] = [];
  let duration: number | null = null;
  let end = 0;
  let segments = 0;
  let typeSeen = false;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line === "#EXT-X-ENDLIST") continue;
    if (line.startsWith("#EXT-X-PLAYLIST-TYPE:")) {
      typeSeen = true;
      out.push("#EXT-X-PLAYLIST-TYPE:EVENT");
      continue;
    }
    if (line.startsWith("#EXTINF:")) {
      duration = Number.parseFloat(line.slice(8)) || 0;
      pending.push(line);
      continue;
    }
    if (line.startsWith("#")) {
      // Tags before the first segment are the header; later ones belong to the next segment.
      if (duration === null && segments === 0 && pending.length === 0) out.push(line);
      else pending.push(line);
      continue;
    }
    // A segment's URI.
    const d = duration ?? 0;
    if (segments > 0 && end + d > elapsedS + 1e-6) break;
    out.push(...pending, line);
    pending = [];
    duration = null;
    end += d;
    segments += 1;
  }

  if (!typeSeen) {
    const at = out.findIndex((l) => l.startsWith("#EXT-X-TARGETDURATION") || l.startsWith("#EXT-X-VERSION"));
    out.splice(at >= 0 ? at + 1 : 1, 0, "#EXT-X-PLAYLIST-TYPE:EVENT");
  }
  return out.join("\n") + "\n";
}

/** The master playlist without caption tracks (there are no captions while a broadcast is on). */
export function stripSubtitles(text: string): string {
  return text
    .split(/\r?\n/)
    .filter((line) => !/^#EXT-X-MEDIA:.*TYPE=SUBTITLES/.test(line.trim()))
    .map((line) => (line.startsWith("#EXT-X-STREAM-INF:") ? line.replace(/,SUBTITLES="[^"]*"/, "").replace(/SUBTITLES="[^"]*",?/, "") : line))
    .join("\n");
}

/** Is this playlist the master one (it lists the renditions)? */
export function isMasterPlaylist(text: string): boolean {
  return /#EXT-X-STREAM-INF:/.test(text);
}
