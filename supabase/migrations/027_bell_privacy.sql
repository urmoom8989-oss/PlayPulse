-- 027_bell_privacy.sql
-- Two 2020 settings:
--
-- 1. Bell options (the bell_options flag). The bell next to SUBSCRIBED opens
--    All, Personalized or None, like 2020:
--    - subscriptions.notify_level ('all', 'personalized', 'none'), kept in step
--      with the older notify column by a trigger (notify is false only for
--      'none'). Rows from before this file keep what they had: the bell on is
--      'all', off is 'none'. New subscriptions start at 'personalized' while
--      the flag is on for the subscriber, 'all' while it is off.
--    - set_notify_level(channel_id, level), same checks and hourly limit as
--      set_notify.
--    - my_subscriptions() also answers notify_level.
--    - subscriptions_feed(..., only_notify): the bell menu shows every upload
--      of 'all' channels, and of 'personalized' channels only when the person
--      watched one of the channel's videos in the last 30 days or subscribed
--      in the last 14 days.
-- 2. Privacy (the privacy_settings flag), in Settings:
--    - profiles.subscriptions_private and profiles.playlists_private (both on
--      at first, like 2020), not readable through the API: my_privacy() and
--      set_privacy(subscriptions_private, playlists_private).
--    - channel_subscriptions(channel_id, lim): the channels a channel's owner
--      subscribes to, for the CHANNELS tab, only when they made them public
--      (and the flag is on for the person asking). Saved playlists have no
--      page yet; the setting is kept for when they do.
-- And feature_on(key, uid), the one flag check later files use.
--
-- Run after 026_search_spelling.sql. Safe to run more than once.

-- A flag check for SQL --------------------------------------------------------------------

create or replace function public.feature_on(flag_key text, uid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.feature_flags f
    where f.key = flag_key
      and (f.mode = 'everyone' or (f.mode = 'test' and uid is not null and uid = any (f.users)))
  );
$$;

revoke execute on function public.feature_on(text, uuid) from public, anon, authenticated;

-- 1. Bell options -------------------------------------------------------------------------

alter table public.subscriptions add column if not exists notify_level text;

-- Once: rows from before this file keep what the bell said.
update public.subscriptions s
   set notify_level = case when s.notify then 'all' else 'none' end
 where s.notify_level is null;

alter table public.subscriptions alter column notify_level set default 'personalized';
alter table public.subscriptions alter column notify_level set not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'subscriptions_notify_level_valid') then
    alter table public.subscriptions
      add constraint subscriptions_notify_level_valid check (notify_level in ('all', 'personalized', 'none'));
  end if;
end;
$$;

create or replace function public.subscriptions_sync_notify()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    -- Without the flag the bell is still on or off: on means every upload.
    if not public.feature_on('bell_options', new.subscriber_id) and new.notify_level = 'personalized' then
      new.notify_level := 'all';
    end if;
    if not new.notify then
      new.notify_level := 'none';
    end if;
    new.notify := new.notify_level <> 'none';
    return new;
  end if;
  if new.notify_level is distinct from old.notify_level then
    new.notify := new.notify_level <> 'none';
  elsif new.notify is distinct from old.notify then
    new.notify_level := case
      when not new.notify then 'none'
      when old.notify_level = 'none' then 'all'
      else old.notify_level
    end;
  end if;
  return new;
end;
$$;

revoke execute on function public.subscriptions_sync_notify() from public, anon, authenticated;

drop trigger if exists subscriptions_sync_notify on public.subscriptions;
create trigger subscriptions_sync_notify
  before insert or update of notify, notify_level on public.subscriptions
  for each row execute function public.subscriptions_sync_notify();

drop function if exists public.set_notify_level(uuid, text);
create function public.set_notify_level(channel_id uuid, level text)
returns table (subscribed boolean, notify_level text, subscriber_count int)
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid;
  current_level text;
begin
  if level is null or level not in ('all', 'personalized', 'none') then
    raise exception 'bad_request' using errcode = 'P0001';
  end if;
  select s.notify_level into current_level
    from public.subscriptions s
   where s.subscriber_id = auth.uid() and s.channel_id = set_notify_level.channel_id;
  me := public.subscription_change_guard(
    set_notify_level.channel_id,
    current_level is not null and current_level <> level,
    true
  );
  if current_level is null then
    raise exception 'not_subscribed' using errcode = 'P0001';
  end if;
  if not public.feature_on('bell_options', me) then
    raise exception 'bell_options_off' using errcode = 'P0001';
  end if;
  update public.subscriptions s
     set notify_level = level
   where s.subscriber_id = me and s.channel_id = set_notify_level.channel_id;
  return query
    select true, s.notify_level, c.subscriber_count
      from public.subscriptions s
      join public.channels c on c.id = s.channel_id
     where s.subscriber_id = me and s.channel_id = set_notify_level.channel_id;
end;
$$;

revoke execute on function public.set_notify_level(uuid, text) from public;
grant execute on function public.set_notify_level(uuid, text) to authenticated;

-- The guide's list, now with the level. Same rows and order as before.
drop function if exists public.my_subscriptions();
create function public.my_subscriptions()
returns table (
  channel_id uuid,
  handle text,
  name text,
  avatar_url text,
  notify boolean,
  subscribed_at timestamptz,
  latest_upload_at timestamptz,
  unseen int,
  notify_level text
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    c.id,
    c.handle,
    coalesce(nullif(c.name, ''), c.handle),
    c.avatar_url,
    s.notify,
    s.created_at,
    (
      select max(v.published_at) from public.videos v
       where v.channel_id = c.id and v.visibility = 'public' and v.status = 'ready'
    ),
    0,
    s.notify_level
  from public.subscriptions s
  join public.channels c on c.id = s.channel_id
  where s.subscriber_id = (select auth.uid())
  order by 7 desc nulls last, 3, 1;
$$;

revoke execute on function public.my_subscriptions() from public;
grant execute on function public.my_subscriptions() to authenticated;

-- The feed and the bell's list. Personalized: channels the person watched in
-- the last 30 days, or subscribed to in the last 14.
create or replace function public.subscriptions_feed(
  cursor timestamptz default null,
  cursor_id uuid default null,
  lim int default 24,
  only_notify boolean default false
)
returns table (
  id uuid,
  title text,
  duration_s numeric,
  thumbnail_url text,
  hls_key text,
  preview_sprite_key text,
  published_at timestamptz,
  views bigint,
  channel_id uuid,
  channel_handle text,
  channel_name text,
  channel_avatar_url text
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    v.id,
    v.title,
    v.duration_s,
    v.thumbnail_url,
    v.hls_key,
    v.preview_sprite_key,
    v.published_at,
    v.views,
    c.id,
    c.handle,
    coalesce(nullif(c.name, ''), c.handle),
    c.avatar_url
  from public.subscriptions s
  join public.channels c on c.id = s.channel_id
  join public.videos v on v.channel_id = s.channel_id
  where s.subscriber_id = (select auth.uid())
    and (
      not coalesce(subscriptions_feed.only_notify, false)
      or s.notify_level = 'all'
      or (
        s.notify_level = 'personalized'
        and (
          s.created_at > now() - interval '14 days'
          or exists (
            select 1
              from public.watch_history h
              join public.videos hv on hv.id = h.video_id
             where h.user_id = s.subscriber_id
               and hv.channel_id = s.channel_id
               and h.last_at > now() - interval '30 days'
          )
        )
      )
    )
    and v.visibility = 'public'
    and v.status = 'ready'
    and v.published_at is not null
    and (
      subscriptions_feed.cursor is null
      or (v.published_at, v.id) < (subscriptions_feed.cursor, coalesce(subscriptions_feed.cursor_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid))
    )
  order by v.published_at desc, v.id desc
  limit least(greatest(coalesce(subscriptions_feed.lim, 24), 1), 50);
$$;

-- 2. Privacy ------------------------------------------------------------------------------

alter table public.profiles add column if not exists subscriptions_private boolean not null default true;
alter table public.profiles add column if not exists playlists_private boolean not null default true;
revoke select (subscriptions_private, playlists_private) on public.profiles from anon, authenticated;
revoke update (subscriptions_private, playlists_private) on public.profiles from anon, authenticated;

drop function if exists public.my_privacy();
create function public.my_privacy()
returns table (subscriptions_private boolean, playlists_private boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select p.subscriptions_private, p.playlists_private
    from public.profiles p
   where p.id = auth.uid();
$$;

drop function if exists public.set_privacy(boolean, boolean);
create function public.set_privacy(subscriptions_private boolean, playlists_private boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
begin
  if me is null or not exists (select 1 from public.profiles p where p.id = me) then
    raise exception 'not_signed_in' using errcode = 'P0001';
  end if;
  if not public.feature_on('privacy_settings', me) then
    raise exception 'privacy_off' using errcode = 'P0001';
  end if;
  update public.profiles p
     set subscriptions_private = coalesce(set_privacy.subscriptions_private, p.subscriptions_private),
         playlists_private = coalesce(set_privacy.playlists_private, p.playlists_private)
   where p.id = me;
end;
$$;

revoke execute on function public.my_privacy() from public;
revoke execute on function public.set_privacy(boolean, boolean) from public;
grant execute on function public.my_privacy() to authenticated;
grant execute on function public.set_privacy(boolean, boolean) to authenticated;

-- The CHANNELS tab: who a channel's owner subscribes to, when that is public.
-- is_private tells the page to say so instead of "no channels".
drop function if exists public.channel_subscriptions(uuid, int);
create function public.channel_subscriptions(channel_id uuid, lim int default 60)
returns table (
  is_private boolean,
  id uuid,
  handle text,
  name text,
  avatar_url text,
  subscriber_count int
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  owner uuid;
  hidden boolean;
begin
  if not public.feature_on('privacy_settings', auth.uid()) then
    return;
  end if;
  select c.owner_id, p.subscriptions_private into owner, hidden
    from public.channels c
    join public.profiles p on p.id = c.owner_id
   where c.id = channel_subscriptions.channel_id;
  if owner is null then
    return;
  end if;
  if hidden then
    return query select true, null::uuid, null::text, null::text, null::text, null::int;
    return;
  end if;
  return query
    select false, c.id, c.handle, coalesce(nullif(c.name, ''), c.handle), c.avatar_url, c.subscriber_count
      from public.subscriptions s
      join public.channels c on c.id = s.channel_id
     where s.subscriber_id = owner
       and c.suspended_at is null
     order by c.subscriber_count desc, c.handle
     limit least(greatest(coalesce(channel_subscriptions.lim, 60), 1), 100);
end;
$$;

revoke execute on function public.channel_subscriptions(uuid, int) from public;
grant execute on function public.channel_subscriptions(uuid, int) to anon, authenticated;

-- Flags -----------------------------------------------------------------------------------

insert into public.feature_flags (key, label, description, mode)
values
  (
    'bell_options',
    'Bell options',
    'The bell next to SUBSCRIBED opens All, Personalized or None. Personalized notifies about a channel''s uploads when you watched it in the last 30 days or subscribed in the last 14.',
    'off'
  ),
  (
    'privacy_settings',
    'Privacy settings',
    'Settings > Privacy: keep all my subscriptions private, keep all my saved playlists private. Public subscriptions show on the channel''s CHANNELS tab.',
    'off'
  )
on conflict (key) do nothing;
