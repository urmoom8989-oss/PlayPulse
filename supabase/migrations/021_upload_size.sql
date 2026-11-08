-- 021_upload_size.sql
-- Videos up to 5 GiB (5,368,709,120 bytes) instead of 2 GB: create_upload()
-- refuses a bigger file with file_too_big. Keep in step with MAX_UPLOAD_BYTES
-- in lib/upload/rules.ts.
--
-- Rebuilt on 2026-11-08 from the app code: the original file was used on the
-- live database but never pushed to GitHub. It changes only the size limit,
-- reading create_upload() back from the database and running it again with
-- the new number (and widening the videos_source_bytes_range check to match),
-- so a database that already ran the original stays as it is.
--
-- Run after 020_flag_panel.sql. Safe to run more than once.

alter table public.videos drop constraint if exists videos_source_bytes_range;
alter table public.videos add constraint videos_source_bytes_range
  check (source_bytes is null or source_bytes between 1 and 5368709120);

do $$
declare
  fn regprocedure := to_regprocedure('public.create_upload(text, bigint, text)');
  def text;
  fixed text;
begin
  if fn is null then
    raise notice 'create_upload() is missing: run 005_videos.sql first';
    return;
  end if;
  def := pg_get_functiondef(fn);
  fixed := replace(def, 'create_upload.bytes > 2147483648', 'create_upload.bytes > 5368709120');
  if fixed <> def then
    execute fixed;
  end if;
end;
$$;

revoke execute on function public.create_upload(text, bigint, text) from public, anon;
grant execute on function public.create_upload(text, bigint, text) to authenticated;
