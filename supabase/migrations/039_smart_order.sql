-- 039_smart_order.sql
-- Smart order for the encoder. Two videos encoding side by side on one box
-- each ran about 3.5 times slower, so the worker now has two lanes:
--
-- - The quick lane makes every new upload's low quality (360p) one after the
--   other, so each plays within minutes. When a video also needs HD, the quick
--   lane hands the HD part back to the queue (encode_sd_handoff) instead of
--   making it itself.
-- - The HD lane makes 720p and up, one video at a time, at a low CPU priority:
--   it gets the whole box while nothing new is waiting and steps aside when an
--   upload comes in.
--
-- - claim_encode_job(worker, lane): lane 'sd' only hands out videos that still
--   need their low quality, lane 'hd' only the HD part of videos that already
--   play; no lane (older workers) hands out any job, low quality first. Within
--   a lane, people with nothing processing go first, then the oldest (037).
--   The HD part keeps its progress when it is claimed.
-- - encode_sd_handoff(...): the same arguments as encode_sd_ready (038). The
--   video is ready at low quality with hd_pending; the job goes back to the
--   queue for the HD lane with fresh tries.
--
-- Run after 038_sd_first.sql. Safe to run more than once.

-- The claim below builds on 038: stop here, changing nothing, without it.
do $$
begin
  if to_regprocedure('public.encode_sd_ready(uuid, numeric, integer, integer, text, text, text, jsonb)') is null then
    raise exception 'Run 038_sd_first.sql first, then this file.';
  end if;
end;
$$;

create or replace function public.encode_sd_handoff(
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
  perform public.encode_sd_ready(
    encode_sd_handoff.job_id, encode_sd_handoff.duration_s, encode_sd_handoff.width, encode_sd_handoff.height,
    encode_sd_handoff.hls_key, encode_sd_handoff.thumbnail_url, encode_sd_handoff.preview_sprite_key,
    encode_sd_handoff.renditions
  );
  update public.encode_jobs j
     set status = 'queued',
         worker = null,
         attempts = 0,
         error = null,
         heartbeat_at = null,
         finished_at = null
   where j.id = encode_sd_handoff.job_id
  returning * into job;
  return 'queued';
end;
$$;

drop function if exists public.claim_encode_job(text);
drop function if exists public.claim_encode_job(text, text);
create function public.claim_encode_job(worker text, lane text default null)
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
  want text := lower(coalesce(claim_encode_job.lane, ''));
  dead public.encode_jobs;
  next_job public.encode_jobs;
  vid public.videos;
  hd boolean;
begin
  for dead in
    select * from public.encode_jobs j
     where j.status = 'running'
       and (j.worker = me or public.encode_job_stopped(j))
     for update skip locked
  loop
    perform public.encode_give_up_attempt(dead, 'the worker stopped during the encode', true);
  end loop;

  select j.* into next_job
    from public.encode_jobs j
    join public.videos v on v.id = j.video_id
   where j.status = 'queued'
     and v.source_key is not null
     and public.processing_flag_on(v.owner_id)
     and case want
           when 'sd' then v.status in ('uploaded', 'processing')
           when 'hd' then v.status = 'ready' and v.hd_pending
           else v.status in ('uploaded', 'processing') or (v.status = 'ready' and v.hd_pending)
         end
   order by (v.status = 'ready' and v.hd_pending),
            exists (
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

  select * into vid from public.videos v where v.id = next_job.video_id;
  hd := vid.status = 'ready' and vid.hd_pending;

  update public.encode_jobs j
     set status = 'running',
         attempts = j.attempts + 1,
         worker = me,
         started_at = now(),
         heartbeat_at = now(),
         finished_at = null,
         progress = case when hd then j.progress else 0 end
   where j.id = next_job.id
  returning * into next_job;

  if not hd then
    update public.videos v
       set status = 'processing', error = null
     where v.id = next_job.video_id
    returning * into vid;
  end if;

  return query select next_job.id, vid.id, vid.owner_id, vid.source_key, vid.source_bytes, vid.source_mime,
                      next_job.attempts, hd;
end;
$$;

revoke execute on function public.encode_sd_handoff(uuid, numeric, int, int, text, text, text, jsonb) from public, anon, authenticated;
revoke execute on function public.claim_encode_job(text, text) from public, anon, authenticated;
grant execute on function public.encode_sd_handoff(uuid, numeric, int, int, text, text, text, jsonb) to service_role;
grant execute on function public.claim_encode_job(text, text) to service_role;
