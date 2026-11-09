-- 037_parallel_encodes.sql
-- Several videos processing at once. The encoder worker now runs a few jobs
-- side by side (ENCODE_SLOTS, 2 by default), each slot with its own name
-- ("<worker>/1", "<worker>/2"), so one person's long video no longer holds up
-- everybody else's.
--
-- - encode_jobs.heartbeat_at: a running job's worker says it is alive every
--   minute (encode_heartbeat, and every encode_progress). A job counts as
--   stopped when its heartbeat is 10 minutes old, not when it has run for
--   2 h 15 min as before (which would let another slot take over a long
--   encode that is still going). Jobs from a worker without heartbeats keep
--   the old rule.
-- - claim_encode_job(worker): people who have no video processing go first,
--   then the oldest; the rest as before.
-- - encode_release(worker): when a worker starts, it gives back the jobs its
--   slots were running before it restarted ("<worker>" and "<worker>/n").
--
-- Run after 036_optional_channels.sql. Safe to run more than once.

alter table public.encode_jobs add column if not exists heartbeat_at timestamptz;

create or replace function public.encode_job_stopped(j public.encode_jobs)
returns boolean
language sql
stable
set search_path = ''
as $$
  select case
    when j.heartbeat_at is null then j.started_at < now() - public.encode_stale_after()
    else j.heartbeat_at < now() - interval '10 minutes'
  end;
$$;

create or replace function public.claim_encode_job(worker text)
returns table (
  job_id uuid,
  video_id uuid,
  owner_id uuid,
  source_key text,
  source_bytes bigint,
  source_mime text,
  attempt int
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
     and v.status in ('uploaded', 'processing')
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

  update public.videos v
     set status = 'processing', error = null
   where v.id = next_job.video_id
  returning * into vid;

  return query select next_job.id, vid.id, vid.owner_id, vid.source_key, vid.source_bytes, vid.source_mime,
                      next_job.attempts;
end;
$$;

create or replace function public.encode_progress(job_id uuid, pct int)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.encode_jobs j
     set progress = greatest(0, least(100, coalesce(encode_progress.pct, 0))),
         heartbeat_at = now()
   where j.id = encode_progress.job_id and j.status = 'running';
  return found;
end;
$$;

drop function if exists public.encode_heartbeat(uuid);
create function public.encode_heartbeat(job_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.encode_jobs j
     set heartbeat_at = now()
   where j.id = encode_heartbeat.job_id and j.status = 'running';
  return found;
end;
$$;

drop function if exists public.encode_release(text);
create function public.encode_release(worker text)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  me text := left(coalesce(nullif(trim(both from encode_release.worker), ''), 'worker'), 100);
  dead public.encode_jobs;
  n int := 0;
begin
  for dead in
    select * from public.encode_jobs j
     where j.status = 'running'
       and (j.worker = me or j.worker like me || '/%')
     for update skip locked
  loop
    perform public.encode_give_up_attempt(dead, 'the worker stopped during the encode', true);
    n := n + 1;
  end loop;
  return n;
end;
$$;

revoke execute on function public.encode_job_stopped(public.encode_jobs) from public, anon, authenticated;
revoke execute on function public.claim_encode_job(text) from public, anon, authenticated;
revoke execute on function public.encode_progress(uuid, int) from public, anon, authenticated;
revoke execute on function public.encode_heartbeat(uuid) from public, anon, authenticated;
revoke execute on function public.encode_release(text) from public, anon, authenticated;
grant execute on function public.claim_encode_job(text) to service_role;
grant execute on function public.encode_progress(uuid, int) to service_role;
grant execute on function public.encode_heartbeat(uuid) to service_role;
grant execute on function public.encode_release(text) to service_role;
