-- 042_upload_options.sql
-- More of the 2020 upload choices:
--
-- - Unlisted in the uploader (the column allowed it already).
-- - Schedule: videos.publish_at. A scheduled video stays private and goes
--   public at that time; the encoder worker calls publish_scheduled() every
--   minute (a video still processing then goes public when it is ready).
-- - Drafts: videos.draft. "Save as draft" uploads the file and keeps the
--   video private as a draft; the studio's video editor finishes it later.
-- - Paid promotion: videos.paid_promotion. The player says "Includes paid
--   promotion" at the start (video_paid_promotion() for the watch page).
--
-- set_upload_options(video_id, visibility, publish_at, paid_promotion, draft)
-- sets all four for one of the caller's videos. A publish_at keeps the video
-- private until then; public sets published_at once it is ready, like
-- publish_video(). Errors: not_signed_in, not_found, removed, in_trash,
-- bad_visibility, bad_schedule (in the past or more than a year away).
--
-- Run after 041_cards.sql. Safe to run more than once.

alter table public.videos add column if not exists publish_at timestamptz;
alter table public.videos add column if not exists draft boolean not null default false;
alter table public.videos add column if not exists paid_promotion boolean not null default false;

create index if not exists videos_publish_at_idx on public.videos (publish_at) where publish_at is not null;

create or replace function public.set_upload_options(
  video_id uuid,
  visibility text,
  publish_at timestamptz,
  paid_promotion boolean,
  draft boolean
)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  v public.videos;
  vis text := lower(coalesce(set_upload_options.visibility, 'private'));
begin
  if me is null then
    raise exception 'not_signed_in' using errcode = 'P0001';
  end if;
  select * into v from public.videos x where x.id = set_upload_options.video_id for update;
  if not found or v.owner_id <> me then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  if v.removed_at is not null then
    raise exception 'removed' using errcode = 'P0001';
  end if;
  if v.deleted_at is not null then
    raise exception 'in_trash' using errcode = 'P0001';
  end if;
  if vis not in ('public', 'unlisted', 'private') then
    raise exception 'bad_visibility' using errcode = 'P0001';
  end if;
  if set_upload_options.publish_at is not null then
    if set_upload_options.publish_at <= now() or set_upload_options.publish_at > now() + interval '1 year' then
      raise exception 'bad_schedule' using errcode = 'P0001';
    end if;
    -- Scheduled: private until the time comes.
    vis := 'private';
  end if;

  update public.videos x
     set visibility = vis,
         publish_at = set_upload_options.publish_at,
         paid_promotion = coalesce(set_upload_options.paid_promotion, x.paid_promotion),
         draft = coalesce(set_upload_options.draft, false) and set_upload_options.publish_at is null,
         published_at = case
           when vis = 'public' and x.status = 'ready' then coalesce(x.published_at, now())
           else x.published_at
         end
   where x.id = v.id;
  return vis;
end;
$$;

-- The encoder worker, every minute: scheduled videos whose time has come go public.
create or replace function public.publish_scheduled()
returns int
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  n int;
begin
  update public.videos x
     set visibility = 'public',
         publish_at = null,
         draft = false,
         published_at = case when x.status = 'ready' then coalesce(x.published_at, now()) else x.published_at end
   where x.publish_at is not null
     and x.publish_at <= now()
     and x.deleted_at is null
     and x.removed_at is null
     and x.status in ('uploaded', 'processing', 'ready');
  get diagnostics n = row_count;
  return n;
end;
$$;

-- "Includes paid promotion" for a video the caller can watch.
create or replace function public.video_paid_promotion(video_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select v.paid_promotion
      from public.videos v
     where v.id = video_paid_promotion.video_id
       and v.deleted_at is null
       and (v.visibility <> 'private' or v.owner_id = (select auth.uid()))
  ), false);
$$;

revoke execute on function public.set_upload_options(uuid, text, timestamptz, boolean, boolean) from public, anon;
grant execute on function public.set_upload_options(uuid, text, timestamptz, boolean, boolean) to authenticated;
revoke execute on function public.publish_scheduled() from public, anon, authenticated;
grant execute on function public.publish_scheduled() to service_role;
revoke execute on function public.video_paid_promotion(uuid) from public;
grant execute on function public.video_paid_promotion(uuid) to anon, authenticated, service_role;

insert into public.feature_flags (key, label, description, mode)
values (
  'upload_options',
  'Unlisted, schedule, drafts and paid promotion',
  'The uploader offers Unlisted and Schedule (a time it goes public), Save as draft, and "Includes paid promotion"; the studio editor too. Off: Private and Public only.',
  'everyone'
)
on conflict (key) do nothing;
