-- 025_upload_any_size.sql
-- No upload size limit of our own: create_upload() takes videos up to 5 TiB
-- (5,497,558,138,880 bytes), the most S3-compatible storage keeps in one
-- object, instead of 5 GiB. Keep in step with MAX_UPLOAD_BYTES in
-- lib/upload/rules.ts (which also grows the part size past 160 GB, so a file
-- never needs more than 10,000 parts).
--
-- Like 021, it reads create_upload() back from the database and runs it again
-- with only the size check changed (whatever number it had), and widens the
-- videos_source_bytes_range check to match.
--
-- Run after 024_player_extras.sql. Safe to run more than once.

alter table public.videos drop constraint if exists videos_source_bytes_range;
alter table public.videos add constraint videos_source_bytes_range
  check (source_bytes is null or source_bytes between 1 and 5497558138880);

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
  fixed := regexp_replace(def, 'create_upload\.bytes\s*>\s*[0-9]+', 'create_upload.bytes > 5497558138880');
  if fixed <> def then
    execute fixed;
  end if;
end;
$$;

revoke execute on function public.create_upload(text, bigint, text) from public, anon;
grant execute on function public.create_upload(text, bigint, text) to authenticated;
