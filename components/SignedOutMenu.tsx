"use client";

import { useState } from "react";
import { useT } from "@/lib/i18n/client";
import { Menu } from "./Menu";
import { MoreIcon } from "./icons";
import { PrefsMenuItems, PrefsPanel, type PrefView } from "./i18n/PrefsMenu";
import { ThemeMenuItem } from "./ThemeMenuItem";

/** The three dot settings menu shown to signed out visitors: the theme, and Language and Location. */
export function SignedOutMenu() {
  const t = useT();
  const [view, setView] = useState<PrefView | null>(null);
  return (
    <Menu label={t("Settings")} button={<MoreIcon className="h-6 w-6" />} onOpen={() => setView(null)}>
      {(close) =>
        view ? (
          <PrefsPanel view={view} onBack={() => setView(null)} onDone={close} />
        ) : (
          <>
            <ThemeMenuItem />
            <PrefsMenuItems onOpen={setView} />
          </>
        )
      }
    </Menu>
  );
}
