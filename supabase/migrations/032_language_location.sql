-- 032_language_location.sql
-- Language and Location, like 2020 (the language_location flag). The
-- language is the site's own words in English, Spanish, French, German,
-- Portuguese or Japanese, chosen in the account or settings menu and kept in
-- a cookie: nothing for it is stored here. Location picks whose Trending the
-- site shows ("Trending in Canada"):
--
-- - view_events.country: the place the viewer chose (or their browser's),
--   which the site sends with each view ping in the x-viewer-country header;
--   a trigger fills it in. Bot views (030) get a place from a spread like a
--   real audience's.
-- - trending_in(country, lim): Trending ranked by counted views from that
--   place in the last 7 days over the video's age, like feed_videos'
--   trending. The site uses it once a place has 8 such videos, everybody's
--   Trending until then.
-- - the language_location flag (off).
--
-- Run after 031_switch_account.sql. Safe to run more than once.

alter table public.view_events add column if not exists country text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'view_events_country_valid') then
    alter table public.view_events add constraint view_events_country_valid check (country is null or country ~ '^[A-Z]{2}$');
  end if;
end;
$$;

create index if not exists view_events_country_idx on public.view_events (country, day) where counted and country is not null;

create or replace function public.view_events_country()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  headers json;
  place text;
  spread text[] := array['US','US','US','US','US','US','GB','GB','CA','CA','BR','BR','IN','IN','DE','FR','MX','AU','PH','ES','JP','PL','IT','NL','SE','ID','TR','KR','AR','ZA'];
begin
  if new.country is not null then
    return new;
  end if;
  if new.viewer_key like 'bot:%' then
    new.country := spread[1 + floor(random() * array_length(spread, 1))::int];
    return new;
  end if;
  begin
    headers := nullif(current_setting('request.headers', true), '')::json;
  exception when others then
    headers := null;
  end;
  place := upper(coalesce(headers ->> 'x-viewer-country', ''));
  if place ~ '^[A-Z]{2}$' then
    new.country := place;
  end if;
  return new;
end;
$$;

revoke execute on function public.view_events_country() from public, anon, authenticated;

drop trigger if exists view_events_country on public.view_events;
create trigger view_events_country
  before insert on public.view_events
  for each row execute function public.view_events_country();

drop function if exists public.trending_in(text, int);
create function public.trending_in(country text, lim int default 50)
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
  is_short boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with here as (
    select e.video_id, count(*)::double precision as n
      from public.view_events e
     where e.country = upper(trending_in.country)
       and e.counted
       and e.day >= (now() at time zone 'utc')::date - 7
     group by e.video_id
  )
  select v.id, v.title, v.duration_s, v.thumbnail_url, v.hls_key, v.preview_sprite_key, v.published_at, v.views,
         c.id, c.handle, coalesce(nullif(c.name, ''), c.handle), c.avatar_url, coalesce(v.is_short, false)
    from here h
    join public.videos v on v.id = h.video_id
    join public.channels c on c.id = v.channel_id
   where v.visibility = 'public'
     and v.status = 'ready'
     and v.published_at is not null
     and v.published_at > now() - interval '30 days'
     and v.deleted_at is null
     and v.removed_at is null
     and c.suspended_at is null
     and not coalesce(v.is_short, false)
   order by h.n / power(greatest(extract(epoch from now() - v.published_at) / 3600, 1), 1.5) desc, v.id
   limit least(greatest(coalesce(trending_in.lim, 50), 1), 50);
$$;

revoke execute on function public.trending_in(text, int) from public;
grant execute on function public.trending_in(text, int) to anon, authenticated;

insert into public.feature_flags (key, label, description, mode)
values (
  'language_location',
  'Language and Location',
  'Language and Location in the account and settings menus: the site''s menus and buttons in English, Spanish, French, German, Portuguese or Japanese, with local dates and numbers, and Trending for the chosen country.',
  'off'
)
on conflict (key) do nothing;
