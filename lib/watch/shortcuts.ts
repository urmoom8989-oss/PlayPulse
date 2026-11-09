// The keyboard shortcuts dialog (Shift+?), as data, so the dialog and the
// tests read the same list. No imports.

export type Shortcut = { keys: string[]; label: string };
export type ShortcutGroup = { title: string; items: Shortcut[] };

/** The groups and rows of the 2020 "Keyboard shortcuts" dialog, for the keys PlayPulse has. */
export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: "Playback",
    items: [
      { keys: ["k"], label: "Toggle play/pause" },
      { keys: ["j"], label: "Rewind 10 seconds" },
      { keys: ["l"], label: "Fast forward 10 seconds" },
      { keys: [","], label: "Previous frame (while paused)" },
      { keys: ["."], label: "Next frame (while paused)" },
      { keys: ["<"], label: "Decrease playback rate" },
      { keys: [">"], label: "Increase playback rate" },
      { keys: ["←"], label: "Seek backward 5 seconds" },
      { keys: ["→"], label: "Seek forward 5 seconds" },
      { keys: ["0..9"], label: "Seek to specific point in the video (7 advances to 70% of duration)" },
      { keys: ["Home"], label: "Seek to the beginning" },
      { keys: ["End"], label: "Seek to the end" },
    ],
  },
  {
    title: "General",
    items: [
      { keys: ["f"], label: "Toggle full screen" },
      { keys: ["t"], label: "Toggle theater mode" },
      { keys: ["i"], label: "Toggle picture in picture" },
      { keys: ["m"], label: "Toggle mute" },
      { keys: ["↑"], label: "Increase volume 5%" },
      { keys: ["↓"], label: "Decrease volume 5%" },
      { keys: ["/"], label: "Go to search box" },
      { keys: ["Shift", "?"], label: "Show keyboard shortcuts" },
    ],
  },
  {
    title: "Subtitles and closed captions",
    items: [
      { keys: ["c"], label: "If the video supports captions, toggle captions ON/OFF" },
      { keys: ["+"], label: "Increase font size" },
      { keys: ["-"], label: "Decrease font size" },
    ],
  },
];

/** The event the avatar menu sends to open the dialog. */
export const OPEN_SHORTCUTS_EVENT = "playpulse:shortcuts";

/** Is this key press "show the shortcuts" (Shift+/ gives "?"), outside a text field? */
export function isShortcutsKey(e: { key: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean }, typing: boolean): boolean {
  return e.key === "?" && !e.ctrlKey && !e.metaKey && !e.altKey && !typing;
}

/** Is this key press "go to the search box" ("/"), outside a text field? */
export function isSearchKey(e: { key: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean }, typing: boolean): boolean {
  return e.key === "/" && !e.ctrlKey && !e.metaKey && !e.altKey && !typing;
}
