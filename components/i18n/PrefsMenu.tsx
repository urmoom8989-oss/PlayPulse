"use client";

import { useRouter } from "next/navigation";
import { ArrowBackIcon, CheckIcon, ChevronRightIcon, GlobeIcon, TranslateIcon } from "@/components/icons";
import { MenuItem } from "@/components/Menu";
import { savePref, useT } from "@/lib/i18n/client";
import { langName, LANGS, LOCATIONS, locationName, type Lang } from "@/lib/i18n/langs";
import { useFlag, useSession } from "@/lib/store/session";

export type PrefView = "language" | "location";

/** "Language: Español" and "Location: Canada" rows for a settings menu, 2020 style (language_location flag). */
export function PrefsMenuItems({ onOpen }: { onOpen: (view: PrefView) => void }) {
  const on = useFlag("language_location");
  const t = useT();
  const lang = useSession((s) => s.lang);
  const location = useSession((s) => s.location);
  if (!on) return null;
  return (
    <>
      <MenuItem
        icon={<TranslateIcon className="h-6 w-6" />}
        onClick={() => onOpen("language")}
        trailing={<ChevronRightIcon className="h-6 w-6 text-icon" />}
      >
        {t("Language: {name}", { name: langName(lang) })}
      </MenuItem>
      <MenuItem
        icon={<GlobeIcon className="h-6 w-6" />}
        onClick={() => onOpen("location")}
        trailing={<ChevronRightIcon className="h-6 w-6 text-icon" />}
      >
        {t("Location: {name}", { name: locationName(location, lang) })}
      </MenuItem>
    </>
  );
}

/**
 * The list behind one of those rows: every language (in its own name) or
 * every place (in the current language), the current one checked. Picking
 * one remembers it in a cookie and reloads the page's data in it.
 */
export function PrefsPanel({ view, onBack, onDone }: { view: PrefView; onBack: () => void; onDone: () => void }) {
  const router = useRouter();
  const t = useT();
  const lang = useSession((s) => s.lang);
  const location = useSession((s) => s.location);
  const setPrefs = useSession((s) => s.setPrefs);
  const rows =
    view === "language"
      ? LANGS.map((l) => ({ value: l.code as string, label: l.name }))
      : [...LOCATIONS].map((c) => ({ value: c as string, label: locationName(c, lang) })).sort((a, b) => a.label.localeCompare(b.label, lang));
  const current = view === "language" ? lang : location;

  return (
    <div data-prefs-panel={view}>
      <button
        type="button"
        onClick={onBack}
        className="flex h-12 w-full items-center gap-4 border-b border-divider px-4 text-left text-[16px] text-text"
      >
        <ArrowBackIcon className="h-6 w-6 text-icon" />
        {view === "language" ? t("Choose your language") : t("Choose your location")}
      </button>
      <div className="max-h-[60vh] overflow-y-auto py-2" role="group">
        {rows.map((r) => (
          <button
            key={r.value}
            type="button"
            role="menuitemradio"
            aria-checked={r.value === current}
            data-pref={r.value}
            onClick={() => {
              savePref(view === "language" ? "lang" : "location", r.value);
              setPrefs(view === "language" ? { lang: r.value as Lang } : { location: r.value });
              onDone();
              router.refresh();
            }}
            className="flex h-10 w-full items-center gap-4 px-4 text-left text-[14px] text-text hover:bg-hover"
          >
            <span className="grid h-6 w-6 shrink-0 place-items-center">
              {r.value === current && <CheckIcon className="h-5 w-5 text-icon" />}
            </span>
            {r.label}
          </button>
        ))}
      </div>
    </div>
  );
}
