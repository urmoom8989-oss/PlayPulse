-- 041_cards.sql
-- Cards, like 2020: up to 5 per video, each pointing at a video, a channel or
-- a website, with a short message and the second it shows up. At that second
-- the message slides in at the top right of the player for a few seconds; an
-- "i" button there opens the list of the video's cards.
--
-- - video_cards: the cards, in order. Row level security: the owner of the
--   video reads them; everybody else reads them through video_cards_for().
-- - video_cards_for(video_id): the cards of a video the caller can watch,
--   with what they point at (a video that is public or unlisted and ready, or
--   a channel; others are left out, except for the owner).
-- - set_video_cards(video_id, cards): replaces the owner's cards at once.
--   cards is a json array of {kind, video_id | handle | url, message, start_s}.
--   Errors: not_signed_in, not_owner, too_many, bad_card, bad_message,
--   bad_time, bad_url, video_not_found, channel_not_found.
-- - The video_cards flag, on for everyone.
--
-- Run after 040_links_and_pull_refresh.sql. Safe to run more than once.

create table if not exists public.video_cards (
  id uuid primary key default gen_random_uuid(),
  video_id uuid not null references public.videos (id) on delete cascade,
  position smallint not null default 0,
  kind text not null check (kind in ('video', 'channel', 'link')),
  target_video_id uuid references public.videos (id) on delete cascade,
  target_channel_id uuid references public.channels (id) on delete cascade,
  url text check (url is null or (char_length(url) <= 2048 and url ~* '^https?://')),
  message text not null default '' check (char_length(message) <= 30),
  start_s int not null default 0 check (start_s >= 0 and start_s <= 86400),
  created_at timestamptz not null default now(),
  check (
    (kind = 'video' and target_video_id is not null)
    or (kind = 'channel' and target_channel_id is not null)
    or (kind = 'link' and url is not null)
  )
);

create index if not exists video_cards_video_idx on public.video_cards (video_id, position);

alter table public.video_cards enable row level security;

drop policy if exists "owners read their cards" on public.video_cards;
create policy "owners read their cards" on public.video_cards
  for select to authenticated
  using (exists (select 1 from public.videos v where v.id = video_cards.video_id and v.owner_id = (select auth.uid())));

revoke all on public.video_cards from anon, authenticated;
grant select on public.video_cards to authenticated;

create or replace function public.video_cards_for(video_id uuid)
returns table (
  id uuid,
  kind text,
  message text,
  start_s int,
  url text,
  target_video_id uuid,
  video_title text,
  video_thumbnail_url text,
  video_duration_s numeric,
  video_views bigint,
  video_channel_name text,
  channel_handle text,
  channel_name text,
  channel_avatar_url text,
  channel_subscribers bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, c.kind, c.message, c.start_s, c.url,
         tv.id, tv.title, tv.thumbnail_url, tv.duration_s, tv.views, tvc.name,
         ch.handle, ch.name, ch.avatar_url, ch.subscriber_count::bigint
    from public.video_cards c
    join public.videos v on v.id = c.video_id
    left join public.videos tv on tv.id = c.target_video_id
    left join public.channels tvc on tvc.id = tv.channel_id
    left join public.channels ch on ch.id = c.target_channel_id
   where c.video_id = video_cards_for.video_id
     and v.deleted_at is null
     and v.removed_at is null
     and (v.visibility <> 'private' or v.owner_id = (select auth.uid()))
     -- A video card only while that video can be watched by anyone with the link.
     and (
       c.kind <> 'video'
       or v.owner_id = (select auth.uid())
       or (tv.status = 'ready' and tv.visibility <> 'private' and tv.deleted_at is null and tv.removed_at is null)
     )
   order by c.position, c.start_s;
$$;

create or replace function public.set_video_cards(video_id uuid, cards jsonb)
returns int
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  owner uuid;
  card jsonb;
  n int := 0;
  k text;
  msg text;
  secs int;
  link text;
  target_video uuid;
  target_channel uuid;
begin
  if me is null then
    raise exception 'not_signed_in' using errcode = 'P0001';
  end if;
  select v.owner_id into owner from public.videos v where v.id = set_video_cards.video_id and v.deleted_at is null;
  if owner is null or owner <> me then
    raise exception 'not_owner' using errcode = 'P0001';
  end if;
  if set_video_cards.cards is null or jsonb_typeof(set_video_cards.cards) <> 'array' then
    raise exception 'bad_card' using errcode = 'P0001';
  end if;
  if jsonb_array_length(set_video_cards.cards) > 5 then
    raise exception 'too_many' using errcode = 'P0001';
  end if;

  delete from public.video_cards c where c.video_id = set_video_cards.video_id;

  for card in select * from jsonb_array_elements(set_video_cards.cards) loop
    k := card ->> 'kind';
    msg := btrim(coalesce(card ->> 'message', ''));
    if char_length(msg) > 30 then
      raise exception 'bad_message' using errcode = 'P0001';
    end if;
    begin
      secs := coalesce((card ->> 'start_s')::int, 0);
    exception when others then
      raise exception 'bad_time' using errcode = 'P0001';
    end;
    if secs < 0 or secs > 86400 then
      raise exception 'bad_time' using errcode = 'P0001';
    end if;
    target_video := null;
    target_channel := null;
    link := null;

    if k = 'video' then
      begin
        target_video := (card ->> 'video_id')::uuid;
      exception when others then
        raise exception 'video_not_found' using errcode = 'P0001';
      end;
      if not exists (
        select 1 from public.videos t
         where t.id = target_video and t.deleted_at is null and t.removed_at is null
           and (t.owner_id = me or (t.status = 'ready' and t.visibility <> 'private'))
      ) then
        raise exception 'video_not_found' using errcode = 'P0001';
      end if;
    elsif k = 'channel' then
      select ch.id into target_channel
        from public.channels ch
       where lower(ch.handle) = lower(regexp_replace(btrim(coalesce(card ->> 'handle', '')), '^@', ''));
      if target_channel is null then
        raise exception 'channel_not_found' using errcode = 'P0001';
      end if;
    elsif k = 'link' then
      link := btrim(coalesce(card ->> 'url', ''));
      if char_length(link) > 2048 or link !~* '^https?://[^\s/$.?#][^\s]*$' then
        raise exception 'bad_url' using errcode = 'P0001';
      end if;
    else
      raise exception 'bad_card' using errcode = 'P0001';
    end if;

    insert into public.video_cards (video_id, position, kind, target_video_id, target_channel_id, url, message, start_s)
    values (set_video_cards.video_id, n, k, target_video, target_channel, link, msg, secs);
    n := n + 1;
  end loop;
  return n;
end;
$$;

revoke execute on function public.video_cards_for(uuid) from public;
grant execute on function public.video_cards_for(uuid) to anon, authenticated, service_role;
revoke execute on function public.set_video_cards(uuid, jsonb) from public, anon;
grant execute on function public.set_video_cards(uuid, jsonb) to authenticated;

insert into public.feature_flags (key, label, description, mode)
values (
  'video_cards',
  'Cards',
  'Up to 5 cards per video (a video, a channel or a website) that slide in at a set time, with an i button on the player that lists them. Added in the uploader and the studio editor.',
  'everyone'
)
on conflict (key) do nothing;
