-- 033_retry_failed.sql
-- A Retry button for videos whose processing failed (the retry_failed flag).
-- The uploaded file is still in storage, so the owner can have it processed
-- again without uploading it again: the video goes back to 'uploaded' and the
-- queue trigger from 006 gives its job a fresh start (3 new attempts).
--
-- - encode_jobs.manual_retries and last_retry_at: at most 3 retries a day per
--   video, so a file that cannot be read does not keep the encoder busy.
-- - retry_encode(video_id): the owner's failed video, not in the trash, whose
--   upload finished (it has a failed encode job). Answers 'queued'.
--   Errors: not_signed_in, studio_off (flag off), not_found, in_trash,
--   not_failed, cannot_retry (the upload never finished: upload it again),
--   rate_limited, banned, suspended.
-- - encode_jobs stays readable by the video's owner (006), so the studio shows
--   the reason the last attempt gave.
--
-- Run after 032_language_location.sql. Safe to run more than once.

alter table public.encode_jobs add column if not exists manual_retries int not null default 0;
alter table public.encode_jobs add column if not exists last_retry_at timestamptz;

drop function if exists public.retry_encode(uuid);
create function public.retry_encode(video_id uuid)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  v public.videos;
  j public.encode_jobs;
  block text;
begin
  if me is null then
    raise exception 'not_signed_in' using errcode = 'P0001';
  end if;
  if not public.feature_on('retry_failed', me) then
    raise exception 'studio_off' using errcode = 'P0001';
  end if;
  select * into v from public.videos x where x.id = retry_encode.video_id for update;
  if v.id is null or v.owner_id <> me then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  block := public.moderation_block_for(me);
  if block is not null then
    raise exception '%', block using errcode = 'P0001';
  end if;
  if v.deleted_at is not null then
    raise exception 'in_trash' using errcode = 'P0001';
  end if;
  if v.status <> 'failed' then
    raise exception 'not_failed' using errcode = 'P0001';
  end if;
  select * into j from public.encode_jobs e where e.video_id = v.id for update;
  if j.id is null or j.status <> 'failed' then
    raise exception 'cannot_retry' using errcode = 'P0001';
  end if;
  if j.last_retry_at is not null and j.last_retry_at > now() - interval '1 day' and j.manual_retries >= 3 then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;

  update public.encode_jobs e
     set manual_retries = case
           when e.last_retry_at is null or e.last_retry_at <= now() - interval '1 day' then 1
           else e.manual_retries + 1
         end,
         last_retry_at = now()
   where e.id = j.id;
  -- The queue trigger (videos_queue_encode, 006) puts the failed job back in
  -- the queue with 0 attempts when the status becomes 'uploaded'.
  update public.videos x set status = 'uploaded', error = null where x.id = v.id;
  return 'queued';
end;
$$;

revoke execute on function public.retry_encode(uuid) from public, anon;
grant execute on function public.retry_encode(uuid) to authenticated;

insert into public.feature_flags (key, label, description, mode)
values (
  'retry_failed',
  'Retry failed videos',
  'A Retry button on videos whose processing failed (Studio content list and the watch page, owner only): the uploaded file is processed again without uploading it again. At most 3 retries a day per video.',
  'off'
)
on conflict (key) do nothing;
