-- 022_player_extras.sql
-- Player extras, all in the browser: chapters on the progress bar from the
-- timestamps in a description (a list that starts at 0:00, at least 3
-- chapters of 10 seconds or more), timestamps in descriptions and comments
-- that jump the player, the right-click menu (Loop, Copy video URL, Copy video
-- URL at current time, Stats for nerds) and double tap to skip 10 seconds on
-- phones. Nothing is stored: this file only adds the flag, off until the
-- owner switches it on.
--
-- Run after 021_open_uploads_usernames.sql. Safe to run more than once.

insert into public.feature_flags (key, label, description, mode)
values (
  'player_extras',
  'Player extras',
  'Chapters from the description, clickable timestamps in descriptions and comments, the right-click menu (Loop, Copy video URL, Copy video URL at current time, Stats for nerds) and double tap to skip 10 seconds on phones.',
  'off'
)
on conflict (key) do nothing;
