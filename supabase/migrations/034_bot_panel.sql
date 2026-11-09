-- 034_bot_panel.sql
-- Bots only where the owner asks for them. Until now the worker gave every
-- public video of a channel with bots_on (030) views, likes, comments and
-- subscribers on its own. Now nothing happens until the owner orders it in
-- the studio's Bots page (the bots flag, channels with bots_on):
--
-- - public.bot_orders: "this many views, likes, dislikes and comments on this
--   video, and this many subscribers, spread over this long" (right away, an
--   hour, a day or a week). The worker delivers each order a little every
--   minute and records what it delivered; the owner can cancel what is left.
-- - public.bot_live: the Premieres and live broadcasts the owner switched bot
--   viewers and chat on for.
-- - The bot account pool grows when an order needs more accounts than there
--   are (one like, dislike or subscription per account), up to 10,000.
--
-- For the owner (signed in, the bots flag, their channel has bots_on):
--   bot_panel()                         the channel, its public and unlisted
--                                       ready videos and the orders (jsonb)
--   bot_order_add(video_id, views, likes, dislikes, comments, subscribers,
--                 over_minutes)          a new order; video_id null for
--                                       subscribers only
--   bot_order_cancel(order_id)          stops an order, keeps what was delivered
--   bot_live_set(video_id, on)          bot viewers and chat for a broadcast
--   Errors: not_signed_in, bots_off, not_found, not_public, not_ready,
--   bad_amount, empty_order, bad_window, too_many_orders, not_a_broadcast,
--   not_active.
-- For the worker (service role): bot_due_orders(), bot_order_delivered(...),
-- bot_subscribe_to(channel, n), bot_post_comment(video, body), bot_grow(n),
-- bot_pool(), bot_live_targets().
-- bot_targets() and bot_subscribe(n) from 030 now do nothing, so a worker
-- from before this file adds nothing on its own either.
--
-- Run after 033_retry_failed.sql. Safe to run more than once.

-- Tables ---------------------------------------------------------------------------------

create table if not exists public.bot_orders (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.channels (id) on delete cascade,
  video_id uuid references public.videos (id) on delete cascade,
  views int not null default 0,
  likes int not null default 0,
  dislikes int not null default 0,
  comments int not null default 0,
  subscribers int not null default 0,
  done_views int not null default 0,
  done_likes int not null default 0,
  done_dislikes int not null default 0,
  done_comments int not null default 0,
  done_subscribers int not null default 0,
  starts_at timestamptz not null default now(),
  ends_at timestamptz not null default now(),
  status text not null default 'active',
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  constraint bot_orders_status_valid check (status in ('active', 'done', 'cancelled')),
  constraint bot_orders_amounts check (
    views >= 0 and likes >= 0 and dislikes >= 0 and comments >= 0 and subscribers >= 0
    and done_views >= 0 and done_likes >= 0 and done_dislikes >= 0 and done_comments >= 0 and done_subscribers >= 0
  ),
  constraint bot_orders_window check (ends_at >= starts_at),
  constraint bot_orders_video_or_subs check (video_id is not null or (views = 0 and likes = 0 and dislikes = 0 and comments = 0))
);

create index if not exists bot_orders_active_idx on public.bot_orders (starts_at) where status = 'active';
create index if not exists bot_orders_channel_idx on public.bot_orders (channel_id, created_at desc);

alter table public.bot_orders enable row level security;
revoke all on public.bot_orders from anon, authenticated;

create table if not exists public.bot_live (
  video_id uuid primary key references public.videos (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.bot_live enable row level security;
revoke all on public.bot_live from anon, authenticated;

-- Limits ---------------------------------------------------------------------------------

-- The most bot accounts there will ever be (one like or subscription each).
create or replace function public.bot_pool_max()
returns int
language sql
immutable
set search_path = ''
as $$ select 10000 $$;

-- The caller's channel when it may use bots, else an error.
create or replace function public.bot_owner_channel()
returns public.channels
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  ch public.channels;
begin
  if me is null then
    raise exception 'not_signed_in' using errcode = 'P0001';
  end if;
  select * into ch from public.channels c where c.owner_id = me;
  if ch.id is null or not ch.bots_on or ch.suspended_at is not null or not public.feature_on('bots', me) then
    raise exception 'bots_off' using errcode = 'P0001';
  end if;
  return ch;
end;
$$;

-- For the owner ----------------------------------------------------------------------------

drop function if exists public.bot_panel();
create function public.bot_panel()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  ch public.channels := public.bot_owner_channel();
begin
  return jsonb_build_object(
    'channel', jsonb_build_object(
      'id', ch.id,
      'handle', ch.handle,
      'name', coalesce(nullif(ch.name, ''), ch.handle),
      'subscribers', coalesce(ch.subscriber_count, 0),
      'pool', (select count(*) from public.bot_accounts),
      'pool_max', public.bot_pool_max()
    ),
    'videos', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', v.id,
               'title', v.title,
               'visibility', v.visibility,
               'is_short', coalesce(v.is_short, false),
               'duration_s', v.duration_s,
               'published_at', v.published_at,
               'created_at', v.created_at,
               'views', coalesce(v.views, 0),
               'likes', coalesce(v.like_count, 0),
               'dislikes', coalesce((select d.dislike_count from public.video_dislike_counts d where d.video_id = v.id), 0),
               'comments', coalesce(v.comment_count, 0),
               'comments_mode', public.video_comments_mode(v.id),
               'thumbnail_name', v.thumbnail_name,
               'thumbnail_url', v.thumbnail_url,
               'broadcast_kind', v.broadcast_kind,
               'broadcast_at', v.broadcast_at,
               'live_bots', exists (select 1 from public.bot_live l where l.video_id = v.id)
             ) order by coalesce(v.published_at, v.created_at) desc)
        from (
          select x.* from public.videos x
           where x.channel_id = ch.id
             and x.status = 'ready'
             and x.visibility in ('public', 'unlisted')
             and x.deleted_at is null
             and x.removed_at is null
           order by coalesce(x.published_at, x.created_at) desc
           limit 200
        ) v
    ), '[]'::jsonb),
    'orders', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', o.id,
               'video_id', o.video_id,
               'video_title', (select v.title from public.videos v where v.id = o.video_id),
               'views', o.views, 'likes', o.likes, 'dislikes', o.dislikes, 'comments', o.comments, 'subscribers', o.subscribers,
               'done_views', o.done_views, 'done_likes', o.done_likes, 'done_dislikes', o.done_dislikes,
               'done_comments', o.done_comments, 'done_subscribers', o.done_subscribers,
               'starts_at', o.starts_at, 'ends_at', o.ends_at, 'status', o.status,
               'created_at', o.created_at, 'finished_at', o.finished_at
             ) order by o.created_at desc)
        from (
          select * from public.bot_orders b
           where b.channel_id = ch.id
             and (b.status = 'active' or b.created_at > now() - interval '7 days')
           order by b.created_at desc
           limit 50
        ) o
    ), '[]'::jsonb)
  );
end;
$$;

drop function if exists public.bot_order_add(uuid, int, int, int, int, int, int);
create function public.bot_order_add(
  video_id uuid,
  views int,
  likes int,
  dislikes int,
  comments int,
  subscribers int,
  over_minutes int
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  ch public.channels := public.bot_owner_channel();
  v public.videos;
  w int := coalesce(over_minutes, 0);
  new_id uuid;
begin
  if coalesce(views, 0) not between 0 and 1000000
     or coalesce(likes, 0) not between 0 and 10000
     or coalesce(dislikes, 0) not between 0 and 10000
     or coalesce(likes, 0) + coalesce(dislikes, 0) > public.bot_pool_max()
     or coalesce(comments, 0) not between 0 and 1000
     or coalesce(subscribers, 0) not between 0 and 10000 then
    raise exception 'bad_amount' using errcode = 'P0001';
  end if;
  if w not in (0, 60, 1440, 10080) then
    raise exception 'bad_window' using errcode = 'P0001';
  end if;
  if bot_order_add.video_id is null then
    if coalesce(views, 0) + coalesce(likes, 0) + coalesce(dislikes, 0) + coalesce(comments, 0) > 0 then
      raise exception 'not_found' using errcode = 'P0001';
    end if;
  else
    select * into v from public.videos x where x.id = bot_order_add.video_id and x.channel_id = ch.id and x.deleted_at is null;
    if v.id is null then
      raise exception 'not_found' using errcode = 'P0001';
    end if;
    if v.status <> 'ready' then
      raise exception 'not_ready' using errcode = 'P0001';
    end if;
    if v.visibility not in ('public', 'unlisted') or v.removed_at is not null then
      raise exception 'not_public' using errcode = 'P0001';
    end if;
  end if;
  if coalesce(views, 0) + coalesce(likes, 0) + coalesce(dislikes, 0) + coalesce(comments, 0) + coalesce(subscribers, 0) = 0 then
    raise exception 'empty_order' using errcode = 'P0001';
  end if;
  if (select count(*) from public.bot_orders b where b.channel_id = ch.id and b.status = 'active') >= 50 then
    raise exception 'too_many_orders' using errcode = 'P0001';
  end if;
  insert into public.bot_orders (channel_id, video_id, views, likes, dislikes, comments, subscribers, starts_at, ends_at, created_by)
  values (
    ch.id, bot_order_add.video_id,
    coalesce(views, 0), coalesce(likes, 0), coalesce(dislikes, 0), coalesce(comments, 0), coalesce(subscribers, 0),
    now(), now() + make_interval(mins => w), auth.uid()
  )
  returning id into new_id;
  return new_id;
end;
$$;

drop function if exists public.bot_order_cancel(uuid);
create function public.bot_order_cancel(order_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  ch public.channels := public.bot_owner_channel();
begin
  update public.bot_orders b
     set status = 'cancelled', finished_at = now()
   where b.id = bot_order_cancel.order_id and b.channel_id = ch.id and b.status = 'active';
  if not found then
    raise exception 'not_active' using errcode = 'P0001';
  end if;
end;
$$;

drop function if exists public.bot_live_set(uuid, boolean);
create function public.bot_live_set(video_id uuid, on_air boolean)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  ch public.channels := public.bot_owner_channel();
  v public.videos;
begin
  select * into v from public.videos x where x.id = bot_live_set.video_id and x.channel_id = ch.id and x.deleted_at is null;
  if v.id is null then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  if v.broadcast_kind is null or v.broadcast_at is null then
    raise exception 'not_a_broadcast' using errcode = 'P0001';
  end if;
  if coalesce(on_air, false) then
    insert into public.bot_live (video_id) values (v.id) on conflict do nothing;
  else
    delete from public.bot_live l where l.video_id = v.id;
  end if;
  return coalesce(on_air, false);
end;
$$;

-- For the worker --------------------------------------------------------------------------

-- The orders to work on now, with what the comments need to know about the video.
drop function if exists public.bot_due_orders();
create function public.bot_due_orders()
returns table (
  id uuid,
  channel_id uuid,
  video_id uuid,
  views int, likes int, dislikes int, comments int, subscribers int,
  done_views int, done_likes int, done_dislikes int, done_comments int, done_subscribers int,
  starts_at timestamptz,
  ends_at timestamptz,
  title text,
  description text,
  duration_s numeric,
  hls_key text,
  comments_mode text,
  broadcast_at timestamptz,
  usable boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select o.id, o.channel_id, o.video_id,
         o.views, o.likes, o.dislikes, o.comments, o.subscribers,
         o.done_views, o.done_likes, o.done_dislikes, o.done_comments, o.done_subscribers,
         o.starts_at, o.ends_at,
         v.title, v.description, v.duration_s, v.hls_key,
         case when v.id is null then null else public.video_comments_mode(v.id) end,
         v.broadcast_at,
         -- The video can still take bots (public or unlisted, ready, not trashed or removed).
         o.video_id is null or (
           v.status = 'ready' and v.visibility in ('public', 'unlisted') and v.deleted_at is null and v.removed_at is null
         )
    from public.bot_orders o
    join public.channels c on c.id = o.channel_id
    left join public.videos v on v.id = o.video_id
   where o.status = 'active'
     and o.starts_at <= now()
     and c.bots_on
     and c.suspended_at is null
   order by o.starts_at
   limit 100;
$$;

-- Records what the worker delivered; the order is done once everything is.
drop function if exists public.bot_order_delivered(uuid, int, int, int, int, int, boolean);
create function public.bot_order_delivered(
  order_id uuid,
  views int,
  likes int,
  dislikes int,
  comments int,
  subscribers int,
  give_up boolean default false
)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  o public.bot_orders;
begin
  update public.bot_orders b
     set done_views = least(b.views, b.done_views + greatest(coalesce(bot_order_delivered.views, 0), 0)),
         done_likes = least(b.likes, b.done_likes + greatest(coalesce(bot_order_delivered.likes, 0), 0)),
         done_dislikes = least(b.dislikes, b.done_dislikes + greatest(coalesce(bot_order_delivered.dislikes, 0), 0)),
         done_comments = least(b.comments, b.done_comments + greatest(coalesce(bot_order_delivered.comments, 0), 0)),
         done_subscribers = least(b.subscribers, b.done_subscribers + greatest(coalesce(bot_order_delivered.subscribers, 0), 0))
   where b.id = bot_order_delivered.order_id and b.status = 'active'
   returning * into o;
  if o.id is null then
    return 'not_active';
  end if;
  if coalesce(give_up, false)
     or (o.done_views >= o.views and o.done_likes >= o.likes and o.done_dislikes >= o.dislikes
         and o.done_comments >= o.comments and o.done_subscribers >= o.subscribers) then
    update public.bot_orders b set status = 'done', finished_at = now() where b.id = o.id;
    return 'done';
  end if;
  return 'active';
end;
$$;

-- n bot subscribers for one channel (bots that are not subscribed yet).
drop function if exists public.bot_subscribe_to(uuid, int);
create function public.bot_subscribe_to(channel_id uuid, n int)
returns int
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  made int;
begin
  if not exists (select 1 from public.channels c where c.id = bot_subscribe_to.channel_id and c.bots_on and c.suspended_at is null) then
    return 0;
  end if;
  insert into public.subscriptions (subscriber_id, channel_id)
  select b.user_id, bot_subscribe_to.channel_id
    from public.bot_accounts b
   where not exists (select 1 from public.subscriptions s where s.subscriber_id = b.user_id and s.channel_id = bot_subscribe_to.channel_id)
   order by random()
   limit least(greatest(coalesce(n, 0), 0), 500)
  on conflict do nothing;
  get diagnostics made = row_count;
  return made;
end;
$$;

-- A comment from a bot that has not commented on this video lately, saying why
-- when there is none: 'posted', 'duplicate' (that text is already there),
-- 'closed' (comments are off or held) or 'no_bot' (every bot commented lately).
drop function if exists public.bot_post_comment(uuid, text);
create function public.bot_post_comment(video_id uuid, body text)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v public.videos := public.bot_video(bot_post_comment.video_id);
  clean text := btrim(coalesce(body, ''));
  who uuid;
begin
  if public.video_comments_mode(v.id) <> 'on' then
    return 'closed';
  end if;
  if clean = '' or char_length(clean) > 2000
     or exists (select 1 from public.comments c where c.video_id = v.id and lower(c.body) = lower(clean) and c.deleted_at is null) then
    return 'duplicate';
  end if;
  who := public.bot_pick(v.id, 'comment');
  if who is null then
    return 'no_bot';
  end if;
  insert into public.comments (video_id, author_id, body) values (v.id, who, clean);
  return 'posted';
end;
$$;

-- How many bot accounts there are.
drop function if exists public.bot_pool();
create function public.bot_pool()
returns int
language sql
stable
security definer
set search_path = ''
as $$ select count(*)::int from public.bot_accounts $$;

-- Up to n more bot accounts (at most 250 a call, 10,000 in all), made like the
-- first 300 in 030. Answers how many there are now.
drop function if exists public.bot_grow(int);
create function public.bot_grow(n int)
returns int
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  firsts text[] := array['Jake','Ethan','Mason','Liam','Noah','Aiden','Lucas','Logan','Caleb','Ryan','Tyler','Dylan','Owen','Jayden','Carter','Luke','Isaac','Nathan','Evan','Hunter','Connor','Adrian','Kevin','Brandon','Marcus','Diego','Mateo','Andre','Jordan','Cameron','Emma','Olivia','Ava','Mia','Chloe','Lily','Zoe','Hannah','Grace','Ella','Maya','Sofia','Abby','Riley','Nora','Leah','Sara','Kayla','Jasmine','Bella','Alex','Sam','Chris','Max','Ben','Josh','Matt','Nick','Tom','Danny'];
  lasts text[] := array['Miller','Johnson','Garcia','Smith','Brown','Davis','Lopez','Wilson','Anderson','Thomas','Moore','Martin','Lee','Clark','Lewis','Walker','Hall','Young','King','Wright','Scott','Green','Baker','Adams','Nelson','Hill','Ramirez','Campbell','Mitchell','Roberts','Carter','Phillips','Evans','Turner','Torres','Parker','Collins','Edwards','Stewart','Morris'];
  words text[] := array['shadow','pixel','frost','blaze','nova','viper','ghost','storm','toxic','lunar','rapid','sniper','creeper','noob','pro','ninja','dragon','wolf','fox','panda','turbo','glitch','laggy','cosmic','neon','void','rogue','echo','zero','hyper'];
  ends text[] := array['','_yt','gaming','plays','x','tv','fn','mc','_','lol'];
  have int;
  upto int;
  i int;
  h bigint;
  f text;
  l text;
  w text;
  uname text;
  shown text;
  uid uuid;
  col text;
  made uuid[] := '{}';
begin
  -- One grower at a time, so two workers never make the same accounts.
  perform pg_advisory_xact_lock(hashtext('playpulse-bot-grow'));
  select count(*) into have from public.bot_accounts;
  upto := least(public.bot_pool_max(), have + least(greatest(coalesce(n, 0), 0), 250));
  if upto <= have then
    return have;
  end if;
  for i in (have + 1)..upto loop
    h := abs(hashtextextended('playpulse-bot-' || i, 7));
    f := firsts[1 + (h % array_length(firsts, 1))];
    l := lasts[1 + ((h / 61) % array_length(lasts, 1))];
    w := words[1 + ((h / 997) % array_length(words, 1))];
    case i % 5
      when 0 then
        uname := f || l || (10 + h % 90)::text;
        shown := f || ' ' || l;
      when 1 then
        uname := lower(f) || '_' || w || (h % 999)::text;
        shown := uname;
      when 2 then
        uname := w || lower(f) || ends[1 + ((h / 7) % array_length(ends, 1))] || (i % 100)::text;
        shown := uname;
      when 3 then
        uname := lower(f) || lower(left(l, 1)) || (1990 + h % 20)::text;
        shown := f || ' ' || left(l, 1) || '.';
      else
        uname := initcap(w) || initcap(words[1 + ((h / 31) % array_length(words, 1))]) || (h % 100)::text;
        shown := uname;
    end case;
    uname := left(uname, 24);
    uid := gen_random_uuid();
    insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data, created_at, email_confirmed_at)
    values (
      uid,
      'bot-' || replace(uid::text, '-', '') || '@users.invalid',
      jsonb_build_object('username', uname, 'full_name', shown),
      '{"provider": "email", "providers": ["email"]}'::jsonb,
      now() - make_interval(days => (h % 900)::int),
      now()
    );
    update public.profiles p
       set onboarded = true,
           birthdate = (date '1985-01-01' + (h % 7000)::int),
           created_at = now() - make_interval(days => (h % 900)::int)
     where p.id = uid;
    update public.channels c
       set created_at = now() - make_interval(days => (h % 900)::int)
     where c.owner_id = uid;
    insert into public.bot_accounts (user_id) values (uid) on conflict do nothing;
    made := made || uid;
  end loop;
  -- Supabase's auth server wants empty strings, not nulls, in its token columns.
  foreach col in array array['confirmation_token', 'recovery_token', 'email_change_token_new', 'email_change', 'email_change_token_current', 'reauthentication_token', 'phone_change', 'phone_change_token'] loop
    if exists (select 1 from information_schema.columns where table_schema = 'auth' and table_name = 'users' and column_name = col) then
      execute format('update auth.users u set %I = '''' where u.%I is null and u.id = any ($1)', col, col) using made;
    end if;
  end loop;
  if exists (select 1 from information_schema.columns where table_schema = 'auth' and table_name = 'users' and column_name = 'aud') then
    execute 'update auth.users u set aud = ''authenticated'', role = ''authenticated'' where u.aud is null and u.id = any ($1)' using made;
  end if;
  return upto;
end;
$$;

-- The broadcasts the owner switched bot viewers and chat on for.
drop function if exists public.bot_live_targets();
create function public.bot_live_targets()
returns table (
  id uuid,
  title text,
  description text,
  duration_s numeric,
  hls_key text,
  broadcast_kind text,
  broadcast_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select v.id, v.title, v.description, v.duration_s, v.hls_key, v.broadcast_kind, v.broadcast_at
    from public.bot_live l
    join public.videos v on v.id = l.video_id
    join public.channels c on c.id = v.channel_id
   where c.bots_on
     and c.suspended_at is null
     and v.status = 'ready'
     and v.visibility in ('public', 'unlisted')
     and v.deleted_at is null
     and v.removed_at is null
     and v.broadcast_at is not null
     and v.broadcast_at > now() - interval '2 days'
   order by v.broadcast_at
   limit 50;
$$;

-- 030's automatic rounds now find nothing to do, for a worker from before this file.
drop function if exists public.bot_targets();
create function public.bot_targets()
returns table (
  id uuid,
  title text,
  description text,
  tags text[],
  duration_s numeric,
  published_at timestamptz,
  views bigint,
  hls_key text,
  comments_mode text,
  broadcast_kind text,
  broadcast_at timestamptz,
  channel_id uuid
)
language sql
stable
security definer
set search_path = ''
as $$
  select null::uuid, null::text, null::text, null::text[], null::numeric, null::timestamptz, null::bigint,
         null::text, null::text, null::text, null::timestamptz, null::uuid
   where false;
$$;

create or replace function public.bot_subscribe(n int)
returns int
language sql
volatile
security definer
set search_path = ''
as $$ select 0 $$;

-- Who may call what ------------------------------------------------------------------------

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.bot_due_orders()', 'public.bot_order_delivered(uuid, int, int, int, int, int, boolean)',
    'public.bot_subscribe_to(uuid, int)', 'public.bot_pool()', 'public.bot_grow(int)', 'public.bot_live_targets()',
    'public.bot_post_comment(uuid, text)',
    'public.bot_targets()', 'public.bot_subscribe(int)'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
  foreach fn in array array[
    'public.bot_panel()', 'public.bot_order_add(uuid, int, int, int, int, int, int)',
    'public.bot_order_cancel(uuid)', 'public.bot_live_set(uuid, boolean)'
  ] loop
    execute format('revoke execute on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
end;
$$;

revoke execute on function public.bot_owner_channel() from public, anon, authenticated;

update public.feature_flags
   set description = 'The studio''s Bots page for channels with bots_on (@typicalgamer): order bot views, likes, dislikes, comments (from the captions) and subscribers for a video, right away or spread over an hour, a day or a week, and bot viewers and chat for a Premiere or live broadcast. Nothing is added unless it is ordered there. Delivered by the encoder worker.'
 where key = 'bots';
