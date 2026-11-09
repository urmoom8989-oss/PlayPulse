-- 030_bots.sql
-- Bots for the channels that have them (channels.bots_on, set here for
-- @typicalgamer only): views, likes, dislikes, subscribers and comments that
-- read like real ones, plus viewers and chat during its Premieres and live
-- broadcasts. The encoder worker runs them (worker/lib/bots.mjs) when the
-- bots flag is not off; the comments react to moments in each video's
-- auto-generated captions. Bot activity counts like any other everywhere
-- (counts, Trending, analytics).
--
-- - 300 bot accounts made here, with ordinary looking names (auth.users rows
--   with no way to sign in; profiles and channels come from the usual
--   triggers), listed in public.bot_accounts.
-- - public.bot_settings: one row with the rates the worker uses.
-- - For the worker only (service role): bot_targets(), bot_add_views(video,
--   n), bot_react(video, likes, dislikes), bot_subscribe(n),
--   bot_comment(video, body), bot_like_comments(video, n), bot_chat(video,
--   body), bot_presence(video, n), bot_recent_comments(video).
-- Nothing here is readable through the API.
--
-- Run after 029_live.sql. Safe to run more than once.

alter table public.channels add column if not exists bots_on boolean not null default false;
update public.channels set bots_on = true where lower(handle) = 'typicalgamer' and not bots_on;

create table if not exists public.bot_accounts (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.bot_accounts enable row level security;
revoke all on public.bot_accounts from anon, authenticated;

create table if not exists public.bot_settings (
  id boolean primary key default true,
  views_per_day int not null default 400,
  like_rate numeric not null default 0.045,
  dislike_rate numeric not null default 0.002,
  comment_rate numeric not null default 0.004,
  subscribers_per_day int not null default 12,
  live_viewers_min int not null default 25,
  live_viewers_max int not null default 90,
  chat_per_minute numeric not null default 4,
  constraint bot_settings_one_row check (id)
);
insert into public.bot_settings (id) values (true) on conflict (id) do nothing;
alter table public.bot_settings enable row level security;
revoke all on public.bot_settings from anon, authenticated;

-- The accounts -----------------------------------------------------------------------------

do $$
declare
  firsts text[] := array['Jake','Ethan','Mason','Liam','Noah','Aiden','Lucas','Logan','Caleb','Ryan','Tyler','Dylan','Owen','Jayden','Carter','Luke','Isaac','Nathan','Evan','Hunter','Connor','Adrian','Kevin','Brandon','Marcus','Diego','Mateo','Andre','Jordan','Cameron','Emma','Olivia','Ava','Mia','Chloe','Lily','Zoe','Hannah','Grace','Ella','Maya','Sofia','Abby','Riley','Nora','Leah','Sara','Kayla','Jasmine','Bella','Alex','Sam','Chris','Max','Ben','Josh','Matt','Nick','Tom','Danny'];
  lasts text[] := array['Miller','Johnson','Garcia','Smith','Brown','Davis','Lopez','Wilson','Anderson','Thomas','Moore','Martin','Lee','Clark','Lewis','Walker','Hall','Young','King','Wright','Scott','Green','Baker','Adams','Nelson','Hill','Ramirez','Campbell','Mitchell','Roberts','Carter','Phillips','Evans','Turner','Torres','Parker','Collins','Edwards','Stewart','Morris'];
  words text[] := array['shadow','pixel','frost','blaze','nova','viper','ghost','storm','toxic','lunar','rapid','sniper','creeper','noob','pro','ninja','dragon','wolf','fox','panda','turbo','glitch','laggy','cosmic','neon','void','rogue','echo','zero','hyper'];
  ends text[] := array['','_yt','gaming','plays','x','tv','fn','mc','_','lol'];
  have int;
  i int;
  h bigint;
  f text;
  l text;
  w text;
  uname text;
  shown text;
  uid uuid;
begin
  select count(*) into have from public.bot_accounts;
  if have >= 300 then
    return;
  end if;
  for i in (have + 1)..300 loop
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
  end loop;
end;
$$;

-- Supabase's auth server wants empty strings, not nulls, in its token columns.
do $$
declare
  col text;
begin
  foreach col in array array['confirmation_token', 'recovery_token', 'email_change_token_new', 'email_change', 'email_change_token_current', 'reauthentication_token', 'phone_change', 'phone_change_token'] loop
    if exists (select 1 from information_schema.columns where table_schema = 'auth' and table_name = 'users' and column_name = col) then
      execute format(
        'update auth.users u set %I = '''' where u.%I is null and u.id in (select b.user_id from public.bot_accounts b)',
        col, col
      );
    end if;
  end loop;
  if exists (select 1 from information_schema.columns where table_schema = 'auth' and table_name = 'users' and column_name = 'aud') then
    execute 'update auth.users u set aud = ''authenticated'', role = ''authenticated'' where u.aud is null and u.id in (select b.user_id from public.bot_accounts b)';
  end if;
end;
$$;

-- Helpers ---------------------------------------------------------------------------------

-- The video, when its channel has bots and it is public and ready.
create or replace function public.bot_video(video_id uuid)
returns public.videos
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v public.videos;
begin
  select x.* into v
    from public.videos x
    join public.channels c on c.id = x.channel_id
   where x.id = bot_video.video_id
     and c.bots_on
     and x.visibility in ('public', 'unlisted')
     and x.status = 'ready';
  if not found then
    raise exception 'not_a_bot_video' using errcode = 'P0001';
  end if;
  return v;
end;
$$;

-- A random bot that has not done `what` on this video yet ('react', 'comment').
create or replace function public.bot_pick(video_id uuid, what text)
returns uuid
language sql
volatile
security definer
set search_path = ''
as $$
  select b.user_id
    from public.bot_accounts b
   where (what <> 'react' or not exists (select 1 from public.video_reactions r where r.user_id = b.user_id and r.video_id = bot_pick.video_id))
     and (what <> 'comment' or not exists (
       select 1 from public.comments c where c.author_id = b.user_id and c.video_id = bot_pick.video_id and c.created_at > now() - interval '2 days'
     ))
   order by random()
   limit 1;
$$;

-- For the worker --------------------------------------------------------------------------

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
  select v.id, v.title, v.description, v.tags, v.duration_s, v.published_at, v.views, v.hls_key,
         public.video_comments_mode(v.id), v.broadcast_kind, v.broadcast_at, v.channel_id
    from public.videos v
    join public.channels c on c.id = v.channel_id
   where c.bots_on
     and c.suspended_at is null
     and v.visibility = 'public'
     and v.status = 'ready'
     and v.deleted_at is null
     and v.removed_at is null
   order by v.published_at desc nulls last
   limit 200;
$$;

drop function if exists public.bot_get_settings();
create function public.bot_get_settings()
returns setof public.bot_settings
language sql
stable
security definer
set search_path = ''
as $$ select * from public.bot_settings limit 1 $$;

-- n views, each a counted view_events row of its own, like signed out viewers.
drop function if exists public.bot_add_views(uuid, int);
create function public.bot_add_views(video_id uuid, n int)
returns bigint
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v public.videos := public.bot_video(bot_add_views.video_id);
  sources text[] := array['home', 'home', 'home', 'search', 'subscriptions', 'channel', 'other', 'external'];
  k int;
  watched int;
  total bigint;
begin
  if v.broadcast_at is not null and v.broadcast_at > now() then
    return v.views;
  end if;
  for k in 1..least(greatest(coalesce(n, 0), 0), 2000) loop
    watched := greatest(10, floor(coalesce(v.duration_s, 60) * (0.25 + random() * 0.7))::int);
    insert into public.view_events (video_id, viewer_key, day, watched_s, counted, counted_at, reached, source, first_at, last_at)
    values (
      v.id,
      'bot:' || gen_random_uuid()::text,
      (now() at time zone 'utc')::date,
      watched,
      true,
      now(),
      public.stats_reached(0, 0, watched, v.duration_s),
      sources[1 + floor(random() * array_length(sources, 1))::int],
      now() - make_interval(secs => watched),
      now()
    );
  end loop;
  update public.videos x set views = x.views + least(greatest(coalesce(n, 0), 0), 2000) where x.id = v.id returning x.views into total;
  return total;
end;
$$;

drop function if exists public.bot_react(uuid, int, int);
create function public.bot_react(video_id uuid, likes int, dislikes int)
returns int
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v public.videos := public.bot_video(bot_react.video_id);
  who uuid;
  k int;
  made int := 0;
begin
  for k in 1..least(greatest(coalesce(likes, 0), 0) + greatest(coalesce(dislikes, 0), 0), 300) loop
    who := public.bot_pick(v.id, 'react');
    exit when who is null;
    insert into public.video_reactions (user_id, video_id, kind)
    values (who, v.id, case when k <= greatest(coalesce(likes, 0), 0) then 'like' else 'dislike' end)
    on conflict do nothing;
    made := made + 1;
  end loop;
  return made;
end;
$$;

drop function if exists public.bot_subscribe(int);
create function public.bot_subscribe(n int)
returns int
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  ch record;
  made int := 0;
  got int;
begin
  for ch in select c.id from public.channels c where c.bots_on and c.suspended_at is null loop
    insert into public.subscriptions (subscriber_id, channel_id)
    select b.user_id, ch.id
      from public.bot_accounts b
     where not exists (select 1 from public.subscriptions s where s.subscriber_id = b.user_id and s.channel_id = ch.id)
     order by random()
     limit least(greatest(coalesce(n, 0), 0), 100)
    on conflict do nothing;
    get diagnostics got = row_count;
    made := made + got;
  end loop;
  return made;
end;
$$;

-- A comment from a bot that has not commented on this video lately. Skips
-- videos with comments off or held, and the same text twice on one video.
drop function if exists public.bot_comment(uuid, text);
create function public.bot_comment(video_id uuid, body text)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v public.videos := public.bot_video(bot_comment.video_id);
  clean text := btrim(coalesce(body, ''));
  who uuid;
  new_id uuid;
begin
  if public.video_comments_mode(v.id) <> 'on' or clean = '' or char_length(clean) > 2000 then
    return null;
  end if;
  if exists (select 1 from public.comments c where c.video_id = v.id and lower(c.body) = lower(clean) and c.deleted_at is null) then
    return null;
  end if;
  who := public.bot_pick(v.id, 'comment');
  if who is null then
    return null;
  end if;
  insert into public.comments (video_id, author_id, body) values (v.id, who, clean) returning id into new_id;
  return new_id;
end;
$$;

-- Bots like n comments on the video, more often the ones that already have likes.
drop function if exists public.bot_like_comments(uuid, int);
create function public.bot_like_comments(video_id uuid, n int)
returns int
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v public.videos := public.bot_video(bot_like_comments.video_id);
  made int := 0;
  k int;
  target uuid;
  who uuid;
begin
  for k in 1..least(greatest(coalesce(n, 0), 0), 50) loop
    select c.id into target
      from public.comments c
     where c.video_id = v.id and c.deleted_at is null and c.removed_at is null
     order by random() * (c.like_count + 1) desc
     limit 1;
    exit when target is null;
    select b.user_id into who
      from public.bot_accounts b
     where not exists (select 1 from public.comment_likes l where l.user_id = b.user_id and l.comment_id = target)
     order by random()
     limit 1;
    continue when who is null;
    insert into public.comment_likes (user_id, comment_id) values (who, target) on conflict do nothing;
    made := made + 1;
  end loop;
  return made;
end;
$$;

-- What bots said on the video lately, so the worker does not repeat itself.
drop function if exists public.bot_recent_comments(uuid);
create function public.bot_recent_comments(video_id uuid)
returns table (body text)
language sql
stable
security definer
set search_path = ''
as $$
  select c.body from public.comments c
   where c.video_id = bot_recent_comments.video_id and c.deleted_at is null
   order by c.created_at desc
   limit 200;
$$;

-- A live chat line from a random bot, while the broadcast is coming or on.
drop function if exists public.bot_chat(uuid, text);
create function public.bot_chat(video_id uuid, body text)
returns bigint
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v public.videos := public.bot_video(bot_chat.video_id);
  clean text := left(btrim(coalesce(body, '')), 200);
  who uuid;
  new_id bigint;
begin
  if clean = '' or v.broadcast_at is null or public.broadcast_state(v.broadcast_at, v.duration_s) = 'ended' then
    return null;
  end if;
  select b.user_id into who from public.bot_accounts b order by random() limit 1;
  insert into public.live_chat (video_id, user_id, body, offset_s)
  values (v.id, who, clean, round(extract(epoch from now() - v.broadcast_at)::numeric, 3))
  returning id into new_id;
  return new_id;
end;
$$;

-- n bot viewers watching right now (each counts for 30 seconds, like people).
drop function if exists public.bot_presence(uuid, int);
create function public.bot_presence(video_id uuid, n int)
returns int
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v public.videos := public.bot_video(bot_presence.video_id);
begin
  if v.broadcast_at is null or public.broadcast_state(v.broadcast_at, v.duration_s) = 'ended' then
    return 0;
  end if;
  insert into public.live_presence (video_id, viewer, seen_at)
  select v.id, 'bot:' || k, now() from generate_series(1, least(greatest(coalesce(n, 0), 0), 500)) k
  on conflict on constraint live_presence_pkey do update set seen_at = excluded.seen_at;
  return public.live_viewers(v.id);
end;
$$;

-- Only the worker (service role) calls these.
do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.bot_video(uuid)', 'public.bot_pick(uuid, text)', 'public.bot_targets()', 'public.bot_get_settings()',
    'public.bot_add_views(uuid, int)', 'public.bot_react(uuid, int, int)', 'public.bot_subscribe(int)',
    'public.bot_comment(uuid, text)', 'public.bot_like_comments(uuid, int)', 'public.bot_recent_comments(uuid)',
    'public.bot_chat(uuid, text)', 'public.bot_presence(uuid, int)'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end;
$$;

insert into public.feature_flags (key, label, description, mode)
values (
  'bots',
  'Channel bots',
  'Bot views, likes, dislikes, subscribers and comments (from the captions) for channels with bots_on (@typicalgamer), plus viewers and chat during their broadcasts. Run by the encoder worker; any mode but off switches them on.',
  'off'
)
on conflict (key) do nothing;
