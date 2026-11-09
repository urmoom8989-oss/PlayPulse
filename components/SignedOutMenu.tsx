"use client";

import { useFlag } from "@/lib/store/session";
import { Menu, MenuDivider, MenuItem } from "./Menu";
import { KeyboardIcon, MoreIcon } from "./icons";
import { openShortcuts } from "./ShortcutsDialog";
import { ThemeMenuItem } from "./ThemeMenuItem";

/** The three dot settings menu shown to signed out visitors. */
export function SignedOutMenu() {
  const shortcuts = useFlag("more_shortcuts");
  return (
    <Menu label="Settings" button={<MoreIcon className="h-6 w-6" />}>
      {(close) => (
        <>
          <ThemeMenuItem />
          {shortcuts && (
            <>
              <MenuDivider />
              <MenuItem
                icon={<KeyboardIcon className="h-6 w-6" />}
                onClick={() => {
                  close();
                  openShortcuts();
                }}
              >
                Keyboard shortcuts
              </MenuItem>
            </>
          )}
        </>
      )}
    </Menu>
  );
}
