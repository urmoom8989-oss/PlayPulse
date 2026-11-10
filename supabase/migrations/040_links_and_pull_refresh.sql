-- 040_links_and_pull_refresh.sql
-- Two flags, both on for everyone:
--
-- - description_links: web addresses in a video's description open in a new
--   tab and #hashtags lead to /hashtag/<tag>, the videos found for the tag,
--   like the 2020 watch page. Off: the description is plain text (timestamps
--   still jump the player with player extras).
-- - pull_to_refresh: on phones and tablets only (a touch screen without
--   hover), pulling down at the top of a page reloads it, with a round arrow
--   that turns into a spinner. The browser's own pull to refresh is turned off
--   while it is on. Not on the Snips feed, which swipes up and down itself.
--
-- Run after 039_smart_order.sql. Safe to run more than once.

insert into public.feature_flags (key, label, description, mode)
values
  (
    'description_links',
    'Description links',
    'Web addresses in descriptions open in a new tab and #hashtags open /hashtag/<tag>. Off: the description is plain text.',
    'everyone'
  ),
  (
    'pull_to_refresh',
    'Swipe down to refresh',
    'Phones and tablets only: pull down at the top of a page to reload it. Not on the Snips feed.',
    'everyone'
  )
on conflict (key) do nothing;
