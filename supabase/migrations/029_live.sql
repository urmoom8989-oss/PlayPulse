-- 029_live.sql
-- Premieres and live streams made from an upload, with live chat, like 2020.
--
-- A video gets a broadcast: videos.broadcast_kind ('premiere' or 'live') and
-- videos.broadcast_at, when it starts. From then until broadcast_at plus the
-- video's length it plays like a live stream: everybody is at the same point,
-- the media route only lists the segments that have "aired" (so the player
-- treats it as live and can rewind to the start), and there is live chat.
-- Before it starts the watch page counts down, with Set reminder and the
-- waiting room chat; viewers get no video files (watch_video() leaves the
-- playback fields out). Afterwards it is a normal video with chat replay.
--
-- - premieres flag: any channel can make a ready upload a Premiere.
-- - live flag: going live from an upload, only for channels with
--   channels.can_go_live (set here for @typicalgamer).
-- - schedule_broadcast(video_id, kind, at) and cancel_broadcast(video_id) for
--   the owner (a private video becomes public, like a Premiere does).
-- - watch_video() also answers broadcast_kind and broadcast_at.
-- - watch_broadcast(video_id): the broadcast, the viewer's reminder, how many
--   are watching. broadcast_info(ids) for cards.
-- - broadcast_reminders with set_broadcast_reminder(video_id, on) and
--   my_broadcast_alerts(lim) for the bell in the top bar.
-- - live_chat with live_chat_post (signed in, 200 characters, no links, the
--   word list, 1 message per 2 seconds and 20 a minute per video),
--   live_chat_since(video_id, after_id, lim), live_chat_replay(video_id,
--   from_s, to_s) and live_chat_delete(id) (author, channel owner or admin).
-- - live_presence with live_presence_ping(video_id, viewer) answering how many
--   are watching (seen in the last 30 seconds), and live_viewers(video_id).
-- None of the new tables are readable through the API: only the functions.
--
-- Run after 028_bell_privacy.sql. Safe to run more than once.

-- Columns ---------------------------------------------------------------------------------

alter table public.videos add column if not exists broadcast_kind text;
alter table public.videos add column if not exists broadcast_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'videos_broadcast_valid') then
    alter table public.videos add constraint videos_broadcast_valid check (
      (broadcast_kind is null and broadcast_at is null)
      or (broadcast_kind in ('premiere', 'live') and broadcast_at is not null)
    );
  end if;
end;
$$;

create index if not exists videos_broadcast_idx on public.videos (broadcast_at) where broadcast_at is not null;

alter table public.channels add column if not exists can_go_live boolean not null default false;
update public.channels set can_go_live = true where lower(handle) = 'typicalgamer' and not can_go_live;

-- Where a broadcast is: 'upcoming', 'live' or 'ended' (null without one).
create or replace function public.broadcast_state(at timestamptz, duration_s numeric)
returns text
language sql
stable
set search_path = ''
as $$
  select case
    when at is null then null
    when now() < at then 'upcoming'
    when now() < at + make_interval(secs => coalesce(duration_s, 0)::double precision) then 'live'
    else 'ended'
  end;
$$;

-- watch_video(), with the broadcast and no files before it starts ------------------------

drop function if exists public.watch_video(uuid);
create function public.watch_video(video_id uuid)
returns table (
  id uuid,
  title text,
  description text,
  visibility text,
  status text,
  is_owner boolean,
  created_at timestamptz,
  published_at timestamptz,
  duration_s numeric,
  width int,
  height int,
  views bigint,
  renditions jsonb,
  thumbnail_url text,
  hls_key text,
  preview_sprite_key text,
  channel_id uuid,
  channel_handle text,
  channel_name text,
  channel_avatar_url text,
  channel_subscriber_count int,
  broadcast_kind text,
  broadcast_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    v.id,
    v.title,
    v.description,
    v.visibility,
    v.status,
    mine.yes,
    v.created_at,
    v.published_at,
    v.duration_s,
    v.width,
    v.height,
    v.views,
    case when playable.yes then v.renditions end,
    case when shown.yes then v.thumbnail_url end,
    case when playable.yes then v.hls_key end,
    case when playable.yes then v.preview_sprite_key end,
    c.id,
    c.handle,
    coalesce(nullif(c.name, ''), c.handle),
    c.avatar_url,
    c.subscriber_count,
    v.broadcast_kind,
    v.broadcast_at
  from public.videos v
  join public.channels c on c.id = v.channel_id
  cross join lateral (select coalesce(v.owner_id = (select auth.uid()), false) as yes) mine
  cross join lateral (select v.status = 'ready' or mine.yes as yes) shown
  cross join lateral (
    select (v.status = 'ready' and (v.broadcast_at is null or v.broadcast_at <= now())) or mine.yes as yes
  ) playable
  where v.id = watch_video.video_id
    and (mine.yes or v.visibility in ('public', 'unlisted'));
$$;

revoke execute on function public.watch_video(uuid) from public;
grant execute on function public.watch_video(uuid) to anon, authenticated;

-- Scheduling ------------------------------------------------------------------------------

drop function if exists public.schedule_broadcast(uuid, text, timestamptz);
create function public.schedule_broadcast(video_id uuid, kind text, at timestamptz)
returns table (broadcast_kind text, broadcast_at timestamptz, visibility text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  v public.videos;
  starts timestamptz := coalesce(schedule_broadcast.at, now());
begin
  if me is null then
    raise exception 'not_signed_in' using errcode = 'P0001';
  end if;
  if kind not in ('premiere', 'live') then
    raise exception 'bad_request' using errcode = 'P0001';
  end if;
  if not public.feature_on(case when kind = 'live' then 'live' else 'premieres' end, me) then
    raise exception 'broadcast_off' using errcode = 'P0001';
  end if;
  select * into v from public.videos x where x.id = schedule_broadcast.video_id for update;
  if not found or v.owner_id <> me then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  if kind = 'live' and not exists (select 1 from public.channels c where c.id = v.channel_id and c.can_go_live) then
    raise exception 'live_not_allowed' using errcode = 'P0001';
  end if;
  if v.removed_at is not null then
    raise exception 'removed' using errcode = 'P0001';
  end if;
  if v.deleted_at is not null then
    raise exception 'in_trash' using errcode = 'P0001';
  end if;
  if v.status <> 'ready' then
    raise exception 'not_ready' using errcode = 'P0001';
  end if;
  if v.broadcast_at is not null and v.broadcast_at <= now() then
    raise exception 'already_started' using errcode = 'P0001';
  end if;
  if starts < now() - interval '1 minute' or starts > now() + interval '30 days' then
    raise exception 'bad_time' using errcode = 'P0001';
  end if;
  starts := greatest(starts, now());
  update public.videos x
     set broadcast_kind = schedule_broadcast.kind,
         broadcast_at = starts,
         visibility = case when x.visibility = 'private' then 'public' else x.visibility end,
         published_at = coalesce(x.published_at, now())
   where x.id = v.id;
  return query
    select x.broadcast_kind, x.broadcast_at, x.visibility from public.videos x where x.id = v.id;
end;
$$;

drop function if exists public.cancel_broadcast(uuid);
create function public.cancel_broadcast(video_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  v public.videos;
begin
  select * into v from public.videos x where x.id = cancel_broadcast.video_id for update;
  if me is null or not found or v.owner_id <> me then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  if v.broadcast_at is not null and v.broadcast_at <= now() then
    raise exception 'already_started' using errcode = 'P0001';
  end if;
  update public.videos x set broadcast_kind = null, broadcast_at = null where x.id = v.id;
  delete from public.broadcast_reminders r where r.video_id = v.id;
end;
$$;

-- Reminders -------------------------------------------------------------------------------

create table if not exists public.broadcast_reminders (
  user_id uuid not null references public.profiles (id) on delete cascade,
  video_id uuid not null references public.videos (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, video_id)
);

alter table public.broadcast_reminders enable row level security;
revoke all on public.broadcast_reminders from anon, authenticated;

drop function if exists public.set_broadcast_reminder(uuid, boolean);
create function public.set_broadcast_reminder(video_id uuid, "on" boolean)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
begin
  if me is null or not exists (select 1 from public.profiles p where p.id = me) then
    raise exception 'not_signed_in' using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from public.videos v
     where v.id = set_broadcast_reminder.video_id
       and v.visibility in ('public', 'unlisted')
       and v.broadcast_at > now()
  ) then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  if coalesce(set_broadcast_reminder."on", true) then
    if (select count(*) from public.broadcast_reminders r where r.user_id = me and r.created_at > now() - interval '1 hour') >= 60 then
      raise exception 'rate_limited' using errcode = 'P0001';
    end if;
    insert into public.broadcast_reminders (user_id, video_id) values (me, set_broadcast_reminder.video_id)
    on conflict do nothing;
    return true;
  end if;
  delete from public.broadcast_reminders r where r.user_id = me and r.video_id = set_broadcast_reminder.video_id;
  return false;
end;
$$;

-- Broadcasts that started in the last day and that the person asked to be
-- reminded of, shaped like subscriptions_feed() rows for the bell.
drop function if exists public.my_broadcast_alerts(int);
create function public.my_broadcast_alerts(lim int default 20)
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
  channel_avatar_url text,
  broadcast_kind text
)
language sql
stable
security definer
set search_path = ''
as $$
  select v.id, v.title, v.duration_s, v.thumbnail_url, v.hls_key, v.preview_sprite_key,
         v.broadcast_at, v.views, c.id, c.handle, coalesce(nullif(c.name, ''), c.handle), c.avatar_url,
         v.broadcast_kind
    from public.broadcast_reminders r
    join public.videos v on v.id = r.video_id
    join public.channels c on c.id = v.channel_id
   where r.user_id = auth.uid()
     and v.visibility in ('public', 'unlisted')
     and v.status = 'ready'
     and v.broadcast_at <= now()
     and v.broadcast_at > now() - interval '1 day'
   order by v.broadcast_at desc
   limit least(greatest(coalesce(lim, 20), 1), 50);
$$;

-- Presence --------------------------------------------------------------------------------

create table if not exists public.live_presence (
  video_id uuid not null references public.videos (id) on delete cascade,
  viewer text not null,
  seen_at timestamptz not null default now(),
  primary key (video_id, viewer)
);

create index if not exists live_presence_recent_idx on public.live_presence (video_id, seen_at desc);

alter table public.live_presence enable row level security;
revoke all on public.live_presence from anon, authenticated;

create or replace function public.live_viewers(video_id uuid)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::int from public.live_presence p
   where p.video_id = live_viewers.video_id and p.seen_at > now() - interval '30 seconds';
$$;

-- Signed in viewers count by account; everybody else by the key the site
-- passes (a hash of its cookie), hashed again here.
drop function if exists public.live_presence_ping(uuid, text);
create function public.live_presence_ping(video_id uuid, viewer text)
returns int
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  who text;
begin
  if not exists (
    select 1 from public.videos v
     where v.id = live_presence_ping.video_id
       and v.visibility in ('public', 'unlisted')
       and public.broadcast_state(v.broadcast_at, v.duration_s) in ('upcoming', 'live')
  ) then
    return 0;
  end if;
  if me is not null then
    who := 'user:' || me::text;
  elsif viewer is not null and length(viewer) between 16 and 128 then
    who := 'anon:' || md5(viewer);
  else
    return public.live_viewers(live_presence_ping.video_id);
  end if;
  insert into public.live_presence (video_id, viewer, seen_at)
  values (live_presence_ping.video_id, who, now())
  on conflict on constraint live_presence_pkey do update set seen_at = excluded.seen_at;
  if random() < 0.02 then
    delete from public.live_presence p where p.seen_at < now() - interval '5 minutes';
  end if;
  return public.live_viewers(live_presence_ping.video_id);
end;
$$;

-- Reading the broadcast --------------------------------------------------------------------

drop function if exists public.watch_broadcast(uuid);
create function public.watch_broadcast(video_id uuid)
returns table (kind text, at timestamptz, state text, reminded boolean, viewers int, can_go_live boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select v.broadcast_kind,
         v.broadcast_at,
         public.broadcast_state(v.broadcast_at, v.duration_s),
         exists (select 1 from public.broadcast_reminders r where r.user_id = auth.uid() and r.video_id = v.id),
         public.live_viewers(v.id),
         coalesce(c.can_go_live and c.owner_id = auth.uid(), false)
    from public.videos v
    join public.channels c on c.id = v.channel_id
   where v.id = watch_broadcast.video_id
     and (v.visibility in ('public', 'unlisted') or v.owner_id = auth.uid());
$$;

-- For cards: which of these videos are upcoming, live or ended broadcasts.
drop function if exists public.broadcast_info(uuid[]);
create function public.broadcast_info(ids uuid[])
returns table (id uuid, kind text, at timestamptz, state text, viewers int)
language sql
stable
security definer
set search_path = ''
as $$
  select v.id, v.broadcast_kind, v.broadcast_at, public.broadcast_state(v.broadcast_at, v.duration_s),
         case when public.broadcast_state(v.broadcast_at, v.duration_s) in ('upcoming', 'live') then public.live_viewers(v.id) else 0 end
    from public.videos v
   where v.id = any (ids[1:100])
     and v.broadcast_at is not null
     and v.visibility in ('public', 'unlisted');
$$;

-- Can this channel go live (for the studio)? Only its owner asks.
drop function if exists public.my_broadcast_options();
create function public.my_broadcast_options()
returns table (can_go_live boolean, premieres boolean, live boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select c.can_go_live from public.channels c where c.owner_id = auth.uid() limit 1), false),
         public.feature_on('premieres', auth.uid()),
         public.feature_on('live', auth.uid());
$$;

-- Live chat -------------------------------------------------------------------------------

create table if not exists public.live_chat (
  id bigint generated always as identity primary key,
  video_id uuid not null references public.videos (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  body text not null,
  offset_s numeric not null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint live_chat_body_length check (char_length(body) between 1 and 200)
);

create index if not exists live_chat_video_idx on public.live_chat (video_id, id);
create index if not exists live_chat_offset_idx on public.live_chat (video_id, offset_s);
create index if not exists live_chat_user_idx on public.live_chat (user_id, video_id, created_at desc);

alter table public.live_chat enable row level security;
revoke all on public.live_chat from anon, authenticated;

drop function if exists public.live_chat_post(uuid, text);
create function public.live_chat_post(video_id uuid, body text)
returns bigint
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  v public.videos;
  clean text := btrim(regexp_replace(coalesce(body, ''), '\s+', ' ', 'g'));
  last_at timestamptz;
  new_id bigint;
begin
  if me is null or not exists (select 1 from public.profiles p where p.id = me) then
    raise exception 'not_signed_in' using errcode = 'P0001';
  end if;
  select * into v from public.videos x where x.id = live_chat_post.video_id;
  if not found or v.visibility not in ('public', 'unlisted') or v.broadcast_at is null then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  if not public.feature_on(case when v.broadcast_kind = 'live' then 'live' else 'premieres' end, me) then
    raise exception 'chat_off' using errcode = 'P0001';
  end if;
  if public.broadcast_state(v.broadcast_at, v.duration_s) = 'ended' then
    raise exception 'chat_closed' using errcode = 'P0001';
  end if;
  if public.moderation_block_for(me) is not null then
    raise exception 'blocked' using errcode = 'P0001';
  end if;
  if clean = '' or char_length(clean) > 200 then
    raise exception 'bad_length' using errcode = 'P0001';
  end if;
  if public.moderation_link_count(clean) > 0 then
    raise exception 'no_links' using errcode = 'P0001';
  end if;
  if public.moderation_blocked_word(clean) is not null then
    raise exception 'blocked_word' using errcode = 'P0001';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('live_chat:' || me::text, 0));
  select max(c.created_at) into last_at from public.live_chat c where c.user_id = me and c.video_id = v.id;
  if last_at > now() - interval '2 seconds'
     or (select count(*) from public.live_chat c where c.user_id = me and c.video_id = v.id and c.created_at > now() - interval '1 minute') >= 20 then
    raise exception 'slow_down' using errcode = 'P0001';
  end if;
  insert into public.live_chat (video_id, user_id, body, offset_s)
  values (v.id, me, clean, round(extract(epoch from now() - v.broadcast_at)::numeric, 3))
  returning id into new_id;
  return new_id;
end;
$$;

-- Messages after after_id (the newest `lim` when after_id is null), oldest first.
drop function if exists public.live_chat_since(uuid, bigint, int);
create function public.live_chat_since(video_id uuid, after_id bigint default null, lim int default 50)
returns table (
  id bigint,
  offset_s numeric,
  created_at timestamptz,
  body text,
  author_name text,
  author_handle text,
  author_avatar_url text,
  is_owner boolean,
  is_mine boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select * from (
    select m.id, m.offset_s, m.created_at, m.body,
           coalesce(nullif(p.display_name, ''), p.username), ch.handle, p.avatar_url,
           m.user_id = v.owner_id, m.user_id = auth.uid()
      from public.live_chat m
      join public.videos v on v.id = m.video_id
      join public.profiles p on p.id = m.user_id
      left join public.channels ch on ch.owner_id = m.user_id
     where m.video_id = live_chat_since.video_id
       and m.deleted_at is null
       and v.visibility in ('public', 'unlisted')
       and (live_chat_since.after_id is null or m.id > live_chat_since.after_id)
     order by m.id desc
     limit least(greatest(coalesce(live_chat_since.lim, 50), 1), 200)
  ) newest
  order by newest.id;
$$;

-- Chat replay: the messages sent between from_s and to_s seconds into the broadcast.
drop function if exists public.live_chat_replay(uuid, numeric, numeric);
create function public.live_chat_replay(video_id uuid, from_s numeric, to_s numeric)
returns table (
  id bigint,
  offset_s numeric,
  created_at timestamptz,
  body text,
  author_name text,
  author_handle text,
  author_avatar_url text,
  is_owner boolean,
  is_mine boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select m.id, m.offset_s, m.created_at, m.body,
         coalesce(nullif(p.display_name, ''), p.username), ch.handle, p.avatar_url,
         m.user_id = v.owner_id, m.user_id = auth.uid()
    from public.live_chat m
    join public.videos v on v.id = m.video_id
    join public.profiles p on p.id = m.user_id
    left join public.channels ch on ch.owner_id = m.user_id
   where m.video_id = live_chat_replay.video_id
     and m.deleted_at is null
     and v.visibility in ('public', 'unlisted')
     and m.offset_s >= live_chat_replay.from_s
     and m.offset_s < least(live_chat_replay.to_s, live_chat_replay.from_s + 600)
   order by m.offset_s, m.id
   limit 500;
$$;

drop function if exists public.live_chat_delete(bigint);
create function public.live_chat_delete(message_id bigint)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
begin
  update public.live_chat m
     set deleted_at = now()
   where m.id = live_chat_delete.message_id
     and m.deleted_at is null
     and (
       m.user_id = me
       or exists (select 1 from public.videos v where v.id = m.video_id and v.owner_id = me)
       or public.is_admin()
     );
  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
end;
$$;

-- Who may call what ------------------------------------------------------------------------

revoke execute on function public.broadcast_state(timestamptz, numeric) from public;
revoke execute on function public.schedule_broadcast(uuid, text, timestamptz) from public, anon;
revoke execute on function public.cancel_broadcast(uuid) from public, anon;
revoke execute on function public.set_broadcast_reminder(uuid, boolean) from public, anon;
revoke execute on function public.my_broadcast_alerts(int) from public, anon;
revoke execute on function public.live_viewers(uuid) from public;
revoke execute on function public.live_presence_ping(uuid, text) from public;
revoke execute on function public.watch_broadcast(uuid) from public;
revoke execute on function public.broadcast_info(uuid[]) from public;
revoke execute on function public.my_broadcast_options() from public, anon;
revoke execute on function public.live_chat_post(uuid, text) from public, anon;
revoke execute on function public.live_chat_since(uuid, bigint, int) from public;
revoke execute on function public.live_chat_replay(uuid, numeric, numeric) from public;
revoke execute on function public.live_chat_delete(bigint) from public, anon;

grant execute on function public.broadcast_state(timestamptz, numeric) to anon, authenticated;
grant execute on function public.schedule_broadcast(uuid, text, timestamptz) to authenticated;
grant execute on function public.cancel_broadcast(uuid) to authenticated;
grant execute on function public.set_broadcast_reminder(uuid, boolean) to authenticated;
grant execute on function public.my_broadcast_alerts(int) to authenticated;
grant execute on function public.live_viewers(uuid) to anon, authenticated;
grant execute on function public.live_presence_ping(uuid, text) to anon, authenticated;
grant execute on function public.watch_broadcast(uuid) to anon, authenticated;
grant execute on function public.broadcast_info(uuid[]) to anon, authenticated;
grant execute on function public.my_broadcast_options() to authenticated;
grant execute on function public.live_chat_post(uuid, text) to authenticated;
grant execute on function public.live_chat_since(uuid, bigint, int) to anon, authenticated;
grant execute on function public.live_chat_replay(uuid, numeric, numeric) to anon, authenticated;
grant execute on function public.live_chat_delete(bigint) to authenticated;

-- Flags -----------------------------------------------------------------------------------

insert into public.feature_flags (key, label, description, mode)
values
  (
    'premieres',
    'Premieres',
    'Owners can make a ready upload a Premiere at a set time: a countdown page with Set reminder and a waiting room chat, then everybody watches it together with live chat, then chat replay.',
    'off'
  ),
  (
    'live',
    'Live from an upload',
    'Channels allowed to go live (channels.can_go_live, @typicalgamer at first) can stream an upload as a live broadcast: LIVE badge, watching now, live chat, rewind with a LIVE button, chat replay afterwards.',
    'off'
  )
on conflict (key) do nothing;
