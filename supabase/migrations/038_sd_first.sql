-- 038_sd_first.sql
-- Low quality first, HD after, like YouTube in 2020. The encoder makes the
-- renditions below 720p first (a quick run), and the video is ready and plays
-- at 360p within minutes while 720p and 1080p are still processing; they are
-- added to the same video when they are done.
--
-- - videos.hd_pending: true while the HD renditions are still processing (the
--   player says so in its quality menu).
-- - encode_sd_ready(...): the same arguments as encode_done. The video is ready
--   with the low renditions and hd_pending; the job keeps running for HD.
-- - encode_done(...) also clears hd_pending.
-- - When the HD part fails for good, the video stays ready at low quality
--   (hd_pending cleared) instead of failing; a retry of the HD part is claimed
--   like any job, and claim_encode_job says so in its new hd_only column.
-- - video_hd_pending(video_id): whether HD is still being made, for the
--   player's quality menu ("HD is still processing"). Anyone who can open the
--   video (public, unlisted, or their own private one).
--
-- Run after 037_parallel_encodes.sql. Safe to run more than once.

alter table public.videos add column if not exists hd_pending boolean not null default false;

create or replace function public.encode_sd_ready(
  job_id uuid,
  duration_s numeric,
  width int,
  height int,
  hls_key text,
  thumbnail_url text,
  preview_sprite_key text,
  renditions jsonb
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  job public.encode_jobs;
begin
  select * into job from public.encode_jobs j where j.id = encode_sd_ready.job_id for update;
  if job.id is null then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  if job.status <> 'running' then
    raise exception 'not_running' using errcode = 'P0001';
  end if;
  if encode_sd_ready.renditions is null or jsonb_typeof(encode_sd_ready.renditions) <> 'array'
     or jsonb_array_length(encode_sd_ready.renditions) = 0 then
    raise exception 'bad_renditions' using errcode = 'P0001';
  end if;

  update public.videos v
     set status = 'ready',
         hd_pending = true,
         duration_s = encode_sd_ready.duration_s,
         width = encode_sd_ready.width,
         height = encode_sd_ready.height,
         hls_key = encode_sd_ready.hls_key,
         thumbnail_url = nullif(encode_sd_ready.thumbnail_url, ''),
         preview_sprite_key = encode_sd_ready.preview_sprite_key,
         renditions = encode_sd_ready.renditions,
         error = null,
         published_at = case
           when v.visibility = 'public' then coalesce(v.published_at, now())
           else v.published_at
         end
   where v.id = job.video_id;
  return 'ready';
end;
$$;

create or replace function public.encode_done(
  job_id uuid,
  duration_s numeric,
  width int,
  height int,
  hls_key text,
  thumbnail_url text,
  preview_sprite_key text,
  renditions jsonb
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  job public.encode_jobs;
begin
  select * into job from public.encode_jobs j where j.id = encode_done.job_id for update;
  if job.id is null then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  if job.status = 'done' then
    return 'done';
  end if;
  if job.status <> 'running' then
    raise exception 'not_running' using errcode = 'P0001';
  end if;
  if encode_done.renditions is null or jsonb_typeof(encode_done.renditions) <> 'array'
     or jsonb_array_length(encode_done.renditions) = 0 then
    raise exception 'bad_renditions' using errcode = 'P0001';
  end if;

  update public.encode_jobs j
     set status = 'done', progress = 100, error = null, finished_at = now()
   where j.id = job.id;

  update public.videos v
     set status = 'ready',
         hd_pending = false,
         duration_s = encode_done.duration_s,
         width = encode_done.width,
         height = encode_done.height,
         hls_key = encode_done.hls_key,
         thumbnail_url = nullif(encode_done.thumbnail_url, ''),
         preview_sprite_key = encode_done.preview_sprite_key,
         renditions = encode_done.renditions,
         error = null,
         published_at = case
           when v.visibility = 'public' then coalesce(v.published_at, now())
           else v.published_at
         end
   where v.id = job.video_id;
  return 'done';
end;
$$;

create or replace function public.encode_give_up_attempt(job public.encode_jobs, reason text, retry boolean)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  clean_reason text := left(coalesce(nullif(trim(both from reason), ''), 'encode failed'), 200);
begin
  if retry and job.attempts < public.encode_max_attempts() then
    update public.encode_jobs j
       set status = 'queued', progress = 0, worker = null, error = clean_reason, finished_at = null
     where j.id = job.id;
    -- The video stays 'processing' (or 'ready' at low quality) while it waits for the next attempt.
    return 'queued';
  end if;
  update public.encode_jobs j
     set status = 'failed', error = clean_reason, finished_at = now()
   where j.id = job.id;
  -- A video that already plays at low quality stays ready; only its HD is given up.
  update public.videos v
     set hd_pending = false
   where v.id = job.video_id and v.status = 'ready' and v.hd_pending;
  if not found then
    update public.videos v
       set status = 'failed', error = clean_reason
     where v.id = job.video_id;
  end if;
  return 'failed';
end;
$$;

-- 037's claim, now also for the HD part of a ready video, with hd_only.
drop function if exists public.claim_encode_job(text);
create function public.claim_encode_job(worker text)
returns table (
  job_id uuid,
  video_id uuid,
  owner_id uuid,
  source_key text,
  source_bytes bigint,
  source_mime text,
  attempt int,
  hd_only boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  me text := left(coalesce(nullif(trim(both from claim_encode_job.worker), ''), 'worker'), 100);
  dead public.encode_jobs;
  next_job public.encode_jobs;
  vid public.videos;
begin
  for dead in
    select * from public.encode_jobs j
     where j.status = 'running'
       and (j.worker = me or public.encode_job_stopped(j))
     for update skip locked
  loop
    perform public.encode_give_up_attempt(dead, 'the worker stopped during the encode', true);
  end loop;

  -- Someone whose video is processing already waits behind everybody else.
  select j.* into next_job
    from public.encode_jobs j
    join public.videos v on v.id = j.video_id
   where j.status = 'queued'
     and (v.status in ('uploaded', 'processing') or (v.status = 'ready' and v.hd_pending))
     and v.source_key is not null
     and public.processing_flag_on(v.owner_id)
   order by exists (
              select 1
                from public.encode_jobs r
                join public.videos rv on rv.id = r.video_id
               where r.status = 'running' and rv.owner_id = v.owner_id
            ),
            j.created_at
   limit 1
   for update of j skip locked;

  if next_job.id is null then
    return;
  end if;

  update public.encode_jobs j
     set status = 'running',
         attempts = j.attempts + 1,
         worker = me,
         started_at = now(),
         heartbeat_at = now(),
         finished_at = null,
         progress = 0
   where j.id = next_job.id
  returning * into next_job;

  select * into vid from public.videos v where v.id = next_job.video_id;
  if not (vid.status = 'ready' and vid.hd_pending) then
    update public.videos v
       set status = 'processing', error = null
     where v.id = next_job.video_id
    returning * into vid;
  end if;

  return query select next_job.id, vid.id, vid.owner_id, vid.source_key, vid.source_bytes, vid.source_mime,
                      next_job.attempts, (vid.status = 'ready' and vid.hd_pending);
end;
$$;

create or replace function public.video_hd_pending(video_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select v.hd_pending
      from public.videos v
     where v.id = video_hd_pending.video_id
       and v.status = 'ready'
       and v.deleted_at is null
       and (v.visibility <> 'private' or v.owner_id = (select auth.uid()))
  ), false);
$$;

revoke execute on function public.encode_sd_ready(uuid, numeric, int, int, text, text, text, jsonb) from public, anon, authenticated;
revoke execute on function public.encode_done(uuid, numeric, int, int, text, text, text, jsonb) from public, anon, authenticated;
revoke execute on function public.encode_give_up_attempt(public.encode_jobs, text, boolean) from public, anon, authenticated;
revoke execute on function public.claim_encode_job(text) from public, anon, authenticated;
grant execute on function public.encode_sd_ready(uuid, numeric, int, int, text, text, text, jsonb) to service_role;
grant execute on function public.encode_done(uuid, numeric, int, int, text, text, text, jsonb) to service_role;
grant execute on function public.claim_encode_job(text) to service_role;
revoke execute on function public.video_hd_pending(uuid) from public;
grant execute on function public.video_hd_pending(uuid) to anon, authenticated, service_role;
