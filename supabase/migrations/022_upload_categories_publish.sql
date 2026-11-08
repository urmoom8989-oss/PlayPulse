-- 022_upload_categories_publish.sql
-- The upload page's category, custom thumbnail and Publish button:
--
-- - videos.category: one of VIDEO_CATEGORIES in lib/upload/rules.ts, 'Other'
--   when nobody picks one.
-- - update_upload_details(video_id, title, description, visibility, category):
--   the details form, now with the category (bad_category otherwise).
-- - save_upload_thumbnail(video_id, name, url): a custom thumbnail
--   (custom-<random>.<jpg|png|webp> under hls/<video>/) picked while the video
--   uploads or processes. encode_done() keeps it instead of putting the
--   encoder's first still over it.
-- - publish_video(video_id): the explicit Publish action. Makes the video
--   public; it shows once it is ready (encode_done sets published_at).
-- - Errors: not_signed_in, not_found, title_invalid, description_too_long,
--   bad_visibility, bad_category, thumbnail_invalid, not_uploading, not_ready,
--   in_trash, removed.
--
-- Rebuilt on 2026-11-08 from the app code (lib/upload/db.ts and handlers.ts):
-- the original file was used on the live database but never pushed to GitHub.
-- A database that already ran the original does not need this file.
--
-- Run after 021_upload_size.sql. Safe to run more than once.

-- Categories --------------------------------------------------------------------------

alter table public.videos add column if not exists category text not null default 'Other';
alter table public.videos drop constraint if exists videos_category_valid;
alter table public.videos add constraint videos_category_valid
  check (category in ('Music', 'Sports', 'Gaming', 'Movies and TV', 'News', 'Live', 'Other'));

create or replace function public.update_upload_details(
  video_id uuid,
  title text,
  description text,
  visibility text,
  category text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  clean_title text := trim(both from coalesce(update_upload_details.title, ''));
  clean_description text := coalesce(update_upload_details.description, '');
begin
  if me is null then
    raise exception 'not_signed_in' using errcode = 'P0001';
  end if;
  if char_length(clean_title) not between 1 and 100 then
    raise exception 'title_invalid' using errcode = 'P0001';
  end if;
  if char_length(clean_description) > 5000 then
    raise exception 'description_too_long' using errcode = 'P0001';
  end if;
  if update_upload_details.visibility not in ('private', 'unlisted', 'public') then
    raise exception 'bad_visibility' using errcode = 'P0001';
  end if;
  if update_upload_details.category is null
     or update_upload_details.category not in ('Music', 'Sports', 'Gaming', 'Movies and TV', 'News', 'Live', 'Other') then
    raise exception 'bad_category' using errcode = 'P0001';
  end if;
  update public.videos v
     set title = clean_title,
         description = clean_description,
         visibility = update_upload_details.visibility,
         category = update_upload_details.category
   where v.id = update_upload_details.video_id and v.owner_id = me;
  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
end;
$$;

-- A custom thumbnail during the upload ---------------------------------------------------

create or replace function public.save_upload_thumbnail(video_id uuid, name text, url text)
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
  if me is null then
    raise exception 'not_signed_in' using errcode = 'P0001';
  end if;
  select * into v from public.videos x where x.id = save_upload_thumbnail.video_id for update;
  if not found or v.owner_id <> me then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  if v.deleted_at is not null then
    raise exception 'in_trash' using errcode = 'P0001';
  end if;
  if v.status = 'uploading' then
    raise exception 'not_uploading' using errcode = 'P0001';
  end if;
  if v.status = 'failed' then
    raise exception 'not_ready' using errcode = 'P0001';
  end if;
  if save_upload_thumbnail.name is null
     or save_upload_thumbnail.name !~ '^custom-'
     or not public.video_thumbnail_name_is_valid(save_upload_thumbnail.name)
     or (save_upload_thumbnail.url is not null and (
       save_upload_thumbnail.url !~ '^https://'
       or right(save_upload_thumbnail.url, char_length(save_upload_thumbnail.name) + 1) <> '/' || save_upload_thumbnail.name
     )) then
    raise exception 'thumbnail_invalid' using errcode = 'P0001';
  end if;
  update public.videos x
     set thumbnail_name = save_upload_thumbnail.name,
         thumbnail_url = save_upload_thumbnail.url
   where x.id = v.id;
end;
$$;

-- encode_done() keeps a custom thumbnail chosen before the video was ready: its
-- definition is read back with the thumbnail line changed, the rest as it is.
do $$
declare
  fn regprocedure;
  def text;
  fixed text;
begin
  select p.oid::regprocedure into fn
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'encode_done'
   limit 1;
  if fn is null then
    raise notice 'encode_done() is missing: run 006_processing.sql first';
    return;
  end if;
  def := pg_get_functiondef(fn);
  fixed := replace(
    def,
    'thumbnail_url = nullif(encode_done.thumbnail_url, ''''),',
    'thumbnail_url = case when v.thumbnail_name like ''custom-%'' then v.thumbnail_url else nullif(encode_done.thumbnail_url, '''') end,'
  );
  if fixed <> def then
    execute fixed;
  end if;
end;
$$;

-- Publish --------------------------------------------------------------------------------

create or replace function public.publish_video(video_id uuid)
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
  if me is null then
    raise exception 'not_signed_in' using errcode = 'P0001';
  end if;
  select * into v from public.videos x where x.id = publish_video.video_id for update;
  if not found or v.owner_id <> me then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  if v.removed_at is not null then
    raise exception 'removed' using errcode = 'P0001';
  end if;
  if v.deleted_at is not null then
    raise exception 'in_trash' using errcode = 'P0001';
  end if;
  if v.status not in ('uploaded', 'processing', 'ready') then
    raise exception 'not_ready' using errcode = 'P0001';
  end if;
  update public.videos x
     set visibility = 'public',
         published_at = case when x.status = 'ready' then coalesce(x.published_at, now()) else x.published_at end
   where x.id = v.id;
end;
$$;

revoke execute on function public.update_upload_details(uuid, text, text, text, text) from public, anon;
revoke execute on function public.save_upload_thumbnail(uuid, text, text) from public, anon;
revoke execute on function public.publish_video(uuid) from public, anon;
grant execute on function public.update_upload_details(uuid, text, text, text, text) to authenticated;
grant execute on function public.save_upload_thumbnail(uuid, text, text) to authenticated;
grant execute on function public.publish_video(uuid) to authenticated;
