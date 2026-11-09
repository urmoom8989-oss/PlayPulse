"use client";

import { useEffect } from "react";
import { useT } from "@/lib/i18n/client";
import { useUi } from "@/lib/store/ui";
import { MenuItem } from "./Menu";
import { ChevronRightIcon, DarkThemeIcon } from "./icons";

/** "Dark theme: On/Off" row, as in the 2019 menu. */
export function ThemeMenuItem() {
  const t = useT();
  const theme = useUi((s) => s.theme);
  const setTheme = useUi((s) => s.setTheme);
  const syncTheme = useUi((s) => s.syncTheme);
  useEffect(syncTheme, [syncTheme]);

  return (
    <MenuItem
      icon={<DarkThemeIcon className="h-6 w-6" />}
      onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
      trailing={<ChevronRightIcon className="h-6 w-6 text-icon" />}
    >
      {theme === "dark" ? t("Dark theme: On") : t("Dark theme: Off")}
    </MenuItem>
  );
}
