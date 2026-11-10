-- 044_watermarks.sql
-- The channel watermark, like 2020's branding watermark: a small picture the
-- channel picks, in the bottom right corner of the player on its videos.
-- Clicking it subscribes. It shows for the entire video, the last 15
-- seconds, or from a custom start time.
--
-- - channels.watermark_url, watermark_show ('entire', 'end' or 'custom') and
--   watermark_start_s (for 'custom'). Readable by everyone like the rest of
--   the channel; changed only through set_channel_watermark().
-- - set_channel_watermark(url, show, start_s): the caller's own channel. url
--   null removes it. Errors: not_signed_in, no_channel, bad_url, bad_show,
--   bad_time.
-- - The public "watermarks" storage bucket: 1 MB max, PNG, JPG or WebP.
--   Each person writes only inside their own folder: watermarks/<user id>/<file>.
-- - The watermark flag, on for everyone.
--
-- Run after 043_playlists.sql. Safe to run more than once.

alter table public.channels add column if not exists watermark_url text;
alter table public.channels add column if not exists watermark_show text not null default 'entire';
alter table public.channels add column if not exists watermark_start_s int not null default 0;

alter table public.channels drop constraint if exists channels_watermark_valid;
alter table public.channels add constraint channels_watermark_valid check (
  (watermark_url is null or (watermark_url ~ '^https://' and char_length(watermark_url) <= 1000))
  and watermark_show in ('entire', 'end', 'custom')
  and watermark_start_s between 0 and 86400
);

grant select (watermark_url, watermark_show, watermark_start_s) on public.channels to anon, authenticated;

create or replace function public.set_channel_watermark(url text, show text, start_s int)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  s text := lower(coalesce(set_channel_watermark.show, 'entire'));
  t int := coalesce(set_channel_watermark.start_s, 0);
begin
  if me is null then
    raise exception 'not_signed_in' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.channels c where c.owner_id = me) then
    raise exception 'no_channel' using errcode = 'P0001';
  end if;
  if set_channel_watermark.url is not null
     and (set_channel_watermark.url !~ '^https://' or char_length(set_channel_watermark.url) > 1000) then
    raise exception 'bad_url' using errcode = 'P0001';
  end if;
  if s not in ('entire', 'end', 'custom') then
    raise exception 'bad_show' using errcode = 'P0001';
  end if;
  if t < 0 or t > 86400 then
    raise exception 'bad_time' using errcode = 'P0001';
  end if;
  update public.channels c
     set watermark_url = set_channel_watermark.url,
         watermark_show = s,
         watermark_start_s = case when s = 'custom' then t else 0 end
   where c.owner_id = me;
end;
$$;

revoke execute on function public.set_channel_watermark(text, text, int) from public, anon;
grant execute on function public.set_channel_watermark(text, text, int) to authenticated;

-- Watermarks bucket ------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('watermarks', 'watermarks', true, 1048576, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "watermarks: owners can list their files" on storage.objects;
create policy "watermarks: owners can list their files"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'watermarks'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "watermarks: owners can upload" on storage.objects;
create policy "watermarks: owners can upload"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'watermarks'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "watermarks: owners can replace" on storage.objects;
create policy "watermarks: owners can replace"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'watermarks'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'watermarks'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "watermarks: owners can delete" on storage.objects;
create policy "watermarks: owners can delete"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'watermarks'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

insert into public.feature_flags (key, label, description, mode)
values (
  'watermark',
  'Channel watermark',
  'A channel''s watermark in the bottom right corner of the player on its videos (clicking it subscribes), set in the studio''s Channel customization. Off: no watermark.',
  'everyone'
)
on conflict (key) do nothing;
