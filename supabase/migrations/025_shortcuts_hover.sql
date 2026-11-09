-- 025_shortcuts_hover.sql
-- Two browser-only features, so this file only adds their flags (off until the
-- owner switches them on):
--
-- - more_shortcuts: the rest of the 2020 player keys (< and > for speed, , and
--   . to step one frame while paused, Home and End), "/" to jump to the search
--   box, and the Keyboard shortcuts dialog (Shift+?, or Keyboard shortcuts in
--   the account and settings menus).
-- - hover_previews: resting the pointer on a thumbnail plays the video, muted,
--   in the thumbnail (after the sprite frames), at the lowest quality that fits
--   the card. Not on touch screens, nor with reduced motion or data saver on.
--
-- Run after 024_player_extras.sql. Safe to run more than once.

insert into public.feature_flags (key, label, description, mode)
values
  (
    'more_shortcuts',
    'More keyboard shortcuts',
    'The rest of the 2020 player keys (< and > change the speed, , and . step one frame while paused, Home and End), / jumps to the search box, and Shift+? shows the Keyboard shortcuts dialog (also in the account and settings menus).',
    'off'
  ),
  (
    'hover_previews',
    'Hover previews',
    'Resting the pointer on a thumbnail plays the video there, muted, at the lowest quality that fits. Not on touch screens, nor with reduced motion or data saver on.',
    'off'
  )
on conflict (key) do nothing;
