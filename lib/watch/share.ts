// The share box's buttons: where each one sends the link (feature: share
// buttons, 2020 style). Pure, so the tests can check every address.

export type ShareTarget = "email" | "messages" | "whatsapp" | "x" | "facebook" | "reddit";

export const SHARE_TARGETS: { key: ShareTarget; label: string }[] = [
  { key: "email", label: "Email" },
  { key: "messages", label: "Messages" },
  { key: "whatsapp", label: "WhatsApp" },
  { key: "x", label: "X" },
  { key: "facebook", label: "Facebook" },
  { key: "reddit", label: "Reddit" },
];

/** The address a share button opens, with the video's title and link filled in. */
export function shareUrl(target: ShareTarget, link: string, title: string): string {
  const t = title.trim();
  const both = t ? `${t} ${link}` : link;
  const e = encodeURIComponent;
  switch (target) {
    case "email":
      return `mailto:?subject=${e(t || "A video for you")}&body=${e(both)}`;
    case "messages":
      // "?&body=" works on both iPhone and Android.
      return `sms:?&body=${e(both)}`;
    case "whatsapp":
      return `https://wa.me/?text=${e(both)}`;
    case "x":
      return `https://twitter.com/intent/tweet?url=${e(link)}${t ? `&text=${e(t)}` : ""}`;
    case "facebook":
      return `https://www.facebook.com/sharer/sharer.php?u=${e(link)}`;
    case "reddit":
      return `https://www.reddit.com/submit?url=${e(link)}${t ? `&title=${e(t)}` : ""}`;
  }
}

/** Email and messages open the device's own app; the rest open the site in a new tab. */
export function opensApp(target: ShareTarget): boolean {
  return target === "email" || target === "messages";
}
