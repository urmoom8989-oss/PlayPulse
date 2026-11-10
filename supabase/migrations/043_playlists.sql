-- 043_playlists.sql
-- Playlists, like 2020: the Save button under a video, Watch later, your own
-- playlists (public, unlisted or private), a playlist page with Play all,
-- renaming and reordering, and the playlist panel next to the player.
--
-- - playlists: one row per playlist. kind 'watch_later' is the one Watch
--   later list each account gets (made the first time my_playlists() runs),
--   always private and never renamed or deleted.
-- - playlist_items: the videos in a playlist, in `position` order.
--   Row level security on both: owners read their own rows; everything else
--   goes through the functions below.
-- - my_playlists(video_id): the caller's playlists, Watch later first, with
--   whether video_id is in each (the Save dialog), the count and a thumbnail.
-- - create_playlist(title, visibility, video_id): a new playlist, with the
--   video in it when one is given. Up to 500 playlists an account.
-- - update_playlist(playlist_id, title, description, visibility): rename,
--   describe, change who can see it (null keeps what is there).
-- - delete_playlist(playlist_id).
-- - set_playlist_video(playlist_id, video_id, saved): add (at the end) or
--   remove a video; answers the playlist's count. Up to 5000 videos.
-- - move_playlist_video(playlist_id, video_id, before_id): reorder; the video
--   goes right before before_id, or to the end when before_id is null.
-- - playlist_header(playlist_id) and playlist_videos(playlist_id, lim, off):
--   the playlist page and the panel on the watch page, for anyone who may
--   see the playlist (public and unlisted ones, or the owner). Only videos
--   the caller can watch are listed; the rest count as hidden.
-- - The playlists flag, on for everyone.
--
-- Errors: not_signed_in, not_found, bad_title, bad_description,
-- bad_visibility, too_many_playlists, too_many_videos, video_not_found,
-- watch_later (Watch later cannot be renamed, shared or deleted),
-- blocked_words (016's word list, when moderation is on).
--
-- Run after 042_upload_options.sql. Safe to run more than once.

create table if not exists public.playlists (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null default 'playlist' check (kind in ('playlist', 'watch_later')),
  title text not null check (char_length(btrim(title)) between 1 and 150),
  description text not null default '' check (char_length(description) <= 5000),
  visibility text not null default 'private' check (visibility in ('public', 'unlisted', 'private')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (kind <> 'watch_later' or visibility = 'private')
);

create unique index if not exists playlists_watch_later_key on public.playlists (owner_id) where kind = 'watch_later';
create index if not exists playlists_owner_idx on public.playlists (owner_id, updated_at desc);

create table if not exists public.playlist_items (
  playlist_id uuid not null references public.playlists (id) on delete cascade,
  video_id uuid not null references public.videos (id) on delete cascade,
  position int not null default 0,
  added_at timestamptz not null default now(),
  primary key (playlist_id, video_id)
);

create index if not exists playlist_items_order_idx on public.playlist_items (playlist_id, position);
create index if not exists playlist_items_video_idx on public.playlist_items (video_id);

alter table public.playlists enable row level security;
alter table public.playlist_items enable row level security;

drop policy if exists "owners read their playlists" on public.playlists;
create policy "owners read their playlists" on public.playlists
  for select to authenticated
  using (owner_id = (select auth.uid()));

drop policy if exists "owners read their playlist items" on public.playlist_items;
create policy "owners read their playlist items" on public.playlist_items
  for select to authenticated
  using (exists (select 1 from public.playlists p where p.id = playlist_items.playlist_id and p.owner_id = (select auth.uid())));

revoke all on public.playlists from anon, authenticated;
revoke all on public.playlist_items from anon, authenticated;
grant select on public.playlists to authenticated;
grant select on public.playlist_items to authenticated;

-- A video the caller can watch: not deleted or removed, ready, and not someone else's private video.
create or replace function public.playlist_video_watchable(v public.videos, viewer uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select v.deleted_at is null
     and v.removed_at is null
     and v.status = 'ready'
     and (v.visibility <> 'private' or v.owner_id = viewer);
$$;

-- The caller's own playlist, locked for a change, or not_found.
create or replace function public.playlist_owned(playlist_id uuid)
returns public.playlists
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  p public.playlists;
begin
  if me is null then
    raise exception 'not_signed_in' using errcode = 'P0001';
  end if;
  select * into p from public.playlists x where x.id = playlist_owned.playlist_id for update;
  if not found or p.owner_id <> me then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  return p;
end;
$$;

create or replace function public.my_playlists(video_id uuid default null)
returns table (
  id uuid,
  kind text,
  title text,
  visibility text,
  item_count int,
  has_video boolean,
  updated_at timestamptz,
  first_video_id uuid,
  first_thumbnail_url text,
  first_hls_key text
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'not_signed_in' using errcode = 'P0001';
  end if;
  insert into public.playlists (owner_id, kind, title, visibility)
  values (me, 'watch_later', 'Watch later', 'private')
  on conflict (owner_id) where kind = 'watch_later' do nothing;

  return query
  select p.id, p.kind, p.title, p.visibility,
         (select count(*)::int from public.playlist_items i where i.playlist_id = p.id),
         my_playlists.video_id is not null
           and exists (select 1 from public.playlist_items i where i.playlist_id = p.id and i.video_id = my_playlists.video_id),
         p.updated_at,
         f.id, f.thumbnail_url, f.hls_key
    from public.playlists p
    left join lateral (
      select v.id, v.thumbnail_url, v.hls_key
        from public.playlist_items i
        join public.videos v on v.id = i.video_id
       where i.playlist_id = p.id and public.playlist_video_watchable(v, me)
       order by i.position, i.added_at
       limit 1
    ) f on true
   where p.owner_id = me
   order by (p.kind = 'watch_later') desc, p.updated_at desc
   limit 500;
end;
$$;

create or replace function public.create_playlist(title text, visibility text, video_id uuid default null)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  t text := btrim(coalesce(create_playlist.title, ''));
  vis text := lower(coalesce(create_playlist.visibility, 'private'));
  new_id uuid;
begin
  if me is null then
    raise exception 'not_signed_in' using errcode = 'P0001';
  end if;
  if char_length(t) < 1 or char_length(t) > 150 then
    raise exception 'bad_title' using errcode = 'P0001';
  end if;
  if vis not in ('public', 'unlisted', 'private') then
    raise exception 'bad_visibility' using errcode = 'P0001';
  end if;
  if public.moderation_flag_on(me) and public.moderation_blocked_word(t) is not null then
    raise exception 'blocked_words' using errcode = 'P0001';
  end if;
  if (select count(*) from public.playlists p where p.owner_id = me) >= 500 then
    raise exception 'too_many_playlists' using errcode = 'P0001';
  end if;
  insert into public.playlists (owner_id, title, visibility) values (me, t, vis) returning id into new_id;
  if create_playlist.video_id is not null then
    perform public.set_playlist_video(new_id, create_playlist.video_id, true);
  end if;
  return new_id;
end;
$$;

create or replace function public.update_playlist(playlist_id uuid, title text, description text, visibility text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  p public.playlists := public.playlist_owned(update_playlist.playlist_id);
  t text := coalesce(btrim(update_playlist.title), p.title);
  d text := coalesce(update_playlist.description, p.description);
  vis text := lower(coalesce(update_playlist.visibility, p.visibility));
begin
  if p.kind = 'watch_later' and (t <> p.title or vis <> 'private' or d <> p.description) then
    raise exception 'watch_later' using errcode = 'P0001';
  end if;
  if char_length(t) < 1 or char_length(t) > 150 then
    raise exception 'bad_title' using errcode = 'P0001';
  end if;
  if char_length(d) > 5000 then
    raise exception 'bad_description' using errcode = 'P0001';
  end if;
  if vis not in ('public', 'unlisted', 'private') then
    raise exception 'bad_visibility' using errcode = 'P0001';
  end if;
  if (t <> p.title or d <> p.description)
     and public.moderation_flag_on(p.owner_id)
     and public.moderation_blocked_word(t || ' ' || d) is not null then
    raise exception 'blocked_words' using errcode = 'P0001';
  end if;
  update public.playlists x
     set title = t, description = d, visibility = vis, updated_at = now()
   where x.id = p.id;
end;
$$;

create or replace function public.delete_playlist(playlist_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  p public.playlists := public.playlist_owned(delete_playlist.playlist_id);
begin
  if p.kind = 'watch_later' then
    raise exception 'watch_later' using errcode = 'P0001';
  end if;
  delete from public.playlists x where x.id = p.id;
end;
$$;

create or replace function public.set_playlist_video(playlist_id uuid, video_id uuid, saved boolean)
returns int
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  p public.playlists := public.playlist_owned(set_playlist_video.playlist_id);
  v public.videos;
  n int;
begin
  if coalesce(set_playlist_video.saved, true) then
    if not exists (select 1 from public.playlist_items i where i.playlist_id = p.id and i.video_id = set_playlist_video.video_id) then
      select * into v from public.videos x where x.id = set_playlist_video.video_id;
      if not found or not public.playlist_video_watchable(v, p.owner_id) then
        raise exception 'video_not_found' using errcode = 'P0001';
      end if;
      if (select count(*) from public.playlist_items i where i.playlist_id = p.id) >= 5000 then
        raise exception 'too_many_videos' using errcode = 'P0001';
      end if;
      insert into public.playlist_items (playlist_id, video_id, position)
      values (
        p.id,
        v.id,
        coalesce((select max(i.position) from public.playlist_items i where i.playlist_id = p.id), 0) + 1
      );
      update public.playlists x set updated_at = now() where x.id = p.id;
    end if;
  else
    delete from public.playlist_items i where i.playlist_id = p.id and i.video_id = set_playlist_video.video_id;
    if found then
      update public.playlists x set updated_at = now() where x.id = p.id;
    end if;
  end if;
  select count(*)::int into n from public.playlist_items i where i.playlist_id = p.id;
  return n;
end;
$$;

create or replace function public.move_playlist_video(playlist_id uuid, video_id uuid, before_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  p public.playlists := public.playlist_owned(move_playlist_video.playlist_id);
begin
  if not exists (select 1 from public.playlist_items i where i.playlist_id = p.id and i.video_id = move_playlist_video.video_id) then
    raise exception 'video_not_found' using errcode = 'P0001';
  end if;
  -- Every other video takes an even place in the current order; the moved one
  -- the odd place right before before_id (or after the last one).
  with ordered as (
    select i.video_id as vid, row_number() over (order by i.position, i.added_at, i.video_id) as rn
      from public.playlist_items i
     where i.playlist_id = p.id and i.video_id <> move_playlist_video.video_id
  ),
  target as (
    select coalesce(
      (select o.rn from ordered o where o.vid = move_playlist_video.before_id),
      (select count(*) + 1 from ordered)
    ) as at
  ),
  placed as (
    select o.vid, (o.rn * 2)::int as pos from ordered o
    union all
    select move_playlist_video.video_id, ((select t.at from target t) * 2 - 1)::int
  )
  update public.playlist_items i
     set position = placed.pos
    from placed
   where i.playlist_id = p.id and i.video_id = placed.vid;
  update public.playlists x set updated_at = now() where x.id = p.id;
end;
$$;

create or replace function public.playlist_header(playlist_id uuid)
returns table (
  id uuid,
  kind text,
  title text,
  description text,
  visibility text,
  updated_at timestamptz,
  is_owner boolean,
  owner_name text,
  owner_handle text,
  owner_avatar_url text,
  item_count int,
  hidden_count int,
  first_video_id uuid,
  first_thumbnail_url text,
  first_hls_key text
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.kind, p.title, p.description, p.visibility, p.updated_at,
         p.owner_id = (select auth.uid()),
         coalesce(nullif(c.name, ''), nullif(pr.display_name, ''), pr.username),
         c.handle,
         coalesce(c.avatar_url, pr.avatar_url),
         counts.shown, counts.total - counts.shown,
         f.id, f.thumbnail_url, f.hls_key
    from public.playlists p
    join public.profiles pr on pr.id = p.owner_id
    left join public.channels c on c.owner_id = p.owner_id
    cross join lateral (
      select count(*)::int as total,
             (count(*) filter (where public.playlist_video_watchable(v, (select auth.uid()))))::int as shown
        from public.playlist_items i
        join public.videos v on v.id = i.video_id
       where i.playlist_id = p.id
    ) counts
    left join lateral (
      select v.id, v.thumbnail_url, v.hls_key
        from public.playlist_items i
        join public.videos v on v.id = i.video_id
       where i.playlist_id = p.id and public.playlist_video_watchable(v, (select auth.uid()))
       order by i.position, i.added_at
       limit 1
    ) f on true
   where p.id = playlist_header.playlist_id
     and (p.owner_id = (select auth.uid()) or (p.kind = 'playlist' and p.visibility <> 'private'));
$$;

create or replace function public.playlist_videos(playlist_id uuid, lim int default 200, off int default 0)
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
  "position" int,
  added_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select v.id, v.title, v.duration_s, v.thumbnail_url, v.hls_key, v.preview_sprite_key,
         coalesce(v.published_at, v.created_at), v.views,
         c.id, c.handle, coalesce(nullif(c.name, ''), c.handle), c.avatar_url,
         i.position, i.added_at
    from public.playlists p
    join public.playlist_items i on i.playlist_id = p.id
    join public.videos v on v.id = i.video_id
    join public.channels c on c.id = v.channel_id
   where p.id = playlist_videos.playlist_id
     and (p.owner_id = (select auth.uid()) or (p.kind = 'playlist' and p.visibility <> 'private'))
     and public.playlist_video_watchable(v, (select auth.uid()))
   order by i.position, i.added_at, v.id
   limit least(greatest(coalesce(playlist_videos.lim, 200), 1), 500)
  offset greatest(coalesce(playlist_videos.off, 0), 0);
$$;

revoke execute on function public.playlist_video_watchable(public.videos, uuid) from public, anon, authenticated;
revoke execute on function public.playlist_owned(uuid) from public, anon, authenticated;
revoke execute on function public.my_playlists(uuid) from public, anon;
revoke execute on function public.create_playlist(text, text, uuid) from public, anon;
revoke execute on function public.update_playlist(uuid, text, text, text) from public, anon;
revoke execute on function public.delete_playlist(uuid) from public, anon;
revoke execute on function public.set_playlist_video(uuid, uuid, boolean) from public, anon;
revoke execute on function public.move_playlist_video(uuid, uuid, uuid) from public, anon;
revoke execute on function public.playlist_header(uuid) from public;
revoke execute on function public.playlist_videos(uuid, int, int) from public;
grant execute on function public.my_playlists(uuid) to authenticated;
grant execute on function public.create_playlist(text, text, uuid) to authenticated;
grant execute on function public.update_playlist(uuid, text, text, text) to authenticated;
grant execute on function public.delete_playlist(uuid) to authenticated;
grant execute on function public.set_playlist_video(uuid, uuid, boolean) to authenticated;
grant execute on function public.move_playlist_video(uuid, uuid, uuid) to authenticated;
grant execute on function public.playlist_header(uuid) to anon, authenticated, service_role;
grant execute on function public.playlist_videos(uuid, int, int) to anon, authenticated, service_role;

insert into public.feature_flags (key, label, description, mode)
values (
  'playlists',
  'Playlists',
  'The Save button under videos (Watch later and your playlists), the playlist page with Play all, renaming and reordering, and the playlist panel next to the player. Off: Save is a placeholder.',
  'everyone'
)
on conflict (key) do nothing;
