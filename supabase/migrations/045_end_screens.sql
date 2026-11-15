-- 045_end_screens.sql
-- End screens, like 2020: up to 4 elements over the last 5 to 20 seconds of
-- a video, each placed where the owner drags it on the player:
--
-- - subscribe: the video's own channel picture; clicking it subscribes.
-- - video: one of the owner's videos (or any public or unlisted one).
-- - channel: another channel, by @handle.
--
-- - end_screen_elements: the elements, in order. x and y are where the
--   element's top left corner sits, as a share of the player's width and
--   height (0 to 1); show_s is how many seconds before the end it appears.
--   Row level security: the owner of the video reads them; everybody else
--   reads them through video_end_screen().
-- - video_end_screen(video_id): the elements of a video the caller can watch,
--   with what they point at (a video element only while that video can be
--   watched; the owner sees all of theirs).
-- - set_video_end_screen(video_id, elements): replaces the owner's elements
--   at once. elements is a json array of {kind, video_id | handle, x, y,
--   show_s}. Errors: not_signed_in, not_owner, too_many, bad_element,
--   bad_place, bad_time, two_subscribes, video_not_found, channel_not_found.
-- - The end_screens flag, on for everyone.
--
-- Run after 044_watermarks.sql. Safe to run more than once.

create table if not exists public.end_screen_elements (
  id uuid primary key default gen_random_uuid(),
  video_id uuid not null references public.videos (id) on delete cascade,
  position smallint not null default 0,
  kind text not null check (kind in ('subscribe', 'video', 'channel')),
  target_video_id uuid references public.videos (id) on delete cascade,
  target_channel_id uuid references public.channels (id) on delete cascade,
  x real not null check (x >= 0 and x <= 1),
  y real not null check (y >= 0 and y <= 1),
  show_s smallint not null default 20 check (show_s between 5 and 20),
  created_at timestamptz not null default now(),
  check (
    (kind = 'subscribe' and target_video_id is null and target_channel_id is null)
    or (kind = 'video' and target_video_id is not null)
    or (kind = 'channel' and target_channel_id is not null)
  )
);

create index if not exists end_screen_elements_video_idx on public.end_screen_elements (video_id, position);

alter table public.end_screen_elements enable row level security;

drop policy if exists "owners read their end screens" on public.end_screen_elements;
create policy "owners read their end screens" on public.end_screen_elements
  for select to authenticated
  using (exists (select 1 from public.videos v where v.id = end_screen_elements.video_id and v.owner_id = (select auth.uid())));

revoke all on public.end_screen_elements from anon, authenticated;
grant select on public.end_screen_elements to authenticated;

create or replace function public.video_end_screen(video_id uuid)
returns table (
  id uuid,
  kind text,
  x real,
  y real,
  show_s smallint,
  target_video_id uuid,
  video_title text,
  video_thumbnail_url text,
  video_hls_key text,
  video_duration_s numeric,
  video_views bigint,
  video_channel_name text,
  channel_id uuid,
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
  select e.id, e.kind, e.x, e.y, e.show_s,
         tv.id, tv.title, tv.thumbnail_url, tv.hls_key, tv.duration_s, tv.views, tvc.name,
         ch.id, ch.handle, coalesce(nullif(ch.name, ''), ch.handle), ch.avatar_url, ch.subscriber_count::bigint
    from public.end_screen_elements e
    join public.videos v on v.id = e.video_id
    left join public.videos tv on tv.id = e.target_video_id
    left join public.channels tvc on tvc.id = tv.channel_id
    -- subscribe: the video's own channel; channel: the one it points at.
    left join public.channels ch on ch.id = case when e.kind = 'subscribe' then v.channel_id else e.target_channel_id end
   where e.video_id = video_end_screen.video_id
     and v.deleted_at is null
     and v.removed_at is null
     and (v.visibility <> 'private' or v.owner_id = (select auth.uid()))
     and (
       e.kind <> 'video'
       or v.owner_id = (select auth.uid())
       or (tv.status = 'ready' and tv.visibility <> 'private' and tv.deleted_at is null and tv.removed_at is null)
     )
   order by e.position;
$$;

create or replace function public.set_video_end_screen(video_id uuid, elements jsonb)
returns int
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  owner uuid;
  el jsonb;
  n int := 0;
  subs int := 0;
  k text;
  px real;
  py real;
  secs int;
  target_video uuid;
  target_channel uuid;
begin
  if me is null then
    raise exception 'not_signed_in' using errcode = 'P0001';
  end if;
  select v.owner_id into owner from public.videos v where v.id = set_video_end_screen.video_id and v.deleted_at is null;
  if owner is null or owner <> me then
    raise exception 'not_owner' using errcode = 'P0001';
  end if;
  if set_video_end_screen.elements is null or jsonb_typeof(set_video_end_screen.elements) <> 'array' then
    raise exception 'bad_element' using errcode = 'P0001';
  end if;
  if jsonb_array_length(set_video_end_screen.elements) > 4 then
    raise exception 'too_many' using errcode = 'P0001';
  end if;

  delete from public.end_screen_elements e where e.video_id = set_video_end_screen.video_id;

  for el in select * from jsonb_array_elements(set_video_end_screen.elements) loop
    k := el ->> 'kind';
    begin
      px := (el ->> 'x')::real;
      py := (el ->> 'y')::real;
    exception when others then
      raise exception 'bad_place' using errcode = 'P0001';
    end;
    if px is null or py is null or px < 0 or px > 1 or py < 0 or py > 1 then
      raise exception 'bad_place' using errcode = 'P0001';
    end if;
    begin
      secs := coalesce((el ->> 'show_s')::int, 20);
    exception when others then
      raise exception 'bad_time' using errcode = 'P0001';
    end;
    if secs < 5 or secs > 20 then
      raise exception 'bad_time' using errcode = 'P0001';
    end if;
    target_video := null;
    target_channel := null;

    if k = 'subscribe' then
      subs := subs + 1;
      if subs > 1 then
        raise exception 'two_subscribes' using errcode = 'P0001';
      end if;
    elsif k = 'video' then
      begin
        target_video := (el ->> 'video_id')::uuid;
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
       where lower(ch.handle) = lower(regexp_replace(btrim(coalesce(el ->> 'handle', '')), '^@', ''));
      if target_channel is null then
        raise exception 'channel_not_found' using errcode = 'P0001';
      end if;
    else
      raise exception 'bad_element' using errcode = 'P0001';
    end if;

    insert into public.end_screen_elements (video_id, position, kind, target_video_id, target_channel_id, x, y, show_s)
    values (set_video_end_screen.video_id, n, k, target_video, target_channel, px, py, secs);
    n := n + 1;
  end loop;
  return n;
end;
$$;

revoke execute on function public.video_end_screen(uuid) from public;
grant execute on function public.video_end_screen(uuid) to anon, authenticated, service_role;
revoke execute on function public.set_video_end_screen(uuid, jsonb) from public, anon;
grant execute on function public.set_video_end_screen(uuid, jsonb) to authenticated;

insert into public.feature_flags (key, label, description, mode)
values (
  'end_screens',
  'End screens',
  'Up to 4 elements (subscribe, a video, a channel) over the last 5 to 20 seconds of a video, placed in the uploader and the studio editor.',
  'everyone'
)
on conflict (key) do nothing;
