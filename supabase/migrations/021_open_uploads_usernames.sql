-- 021_open_uploads_usernames.sql
-- Two rules made looser.
--
-- - Uploads: no daily limit. create_upload() no longer counts the uploads of the
--   last 24 hours, so daily_limit is never raised. Every other check (signed in,
--   the upload flag, finished sign up, 13 or older, a channel, title, size and
--   type) stays as it was in 005_videos.sql.
-- - Usernames: 3 to 24 characters of anything except emoji and invisible
--   characters, no spaces at either end, kept in the case people type.
--   Whether a name is taken still ignores case (profiles_username_lower_key).
--   The reserved names stay reserved in any case. Channel handles (/@handle)
--   are separate and keep their own plain rules (004_channels.sql).
--   Every existing username already passes the new rule.
--
-- Keep in step with lib/upload/rules.ts and lib/accounts/validation.ts (the
-- emoji and invisible character ranges are the same lists; a test compares them).
--
-- Run after 020_flag_panel.sql. Safe to run more than once.

-- Usernames ---------------------------------------------------------------------

create or replace function public.username_is_valid(name text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select name is not null
    and name = btrim(name)
    and char_length(name) between 3 and 24
    -- Emoji (EMOJI_RANGES in lib/accounts/validation.ts).
    and name !~ '[\u200d\u20e3\u231a-\u231b\u23e9-\u23ec\u23f0\u23f3\u25fd-\u25fe\u2614-\u2615\u2648-\u2653\u267f\u2693\u26a1\u26aa-\u26ab\u26bd-\u26be\u26c4-\u26c5\u26ce\u26d4\u26ea\u26f2-\u26f3\u26f5\u26fa\u26fd\u2705\u270a-\u270b\u2728\u274c\u274e\u2753-\u2755\u2757\u2795-\u2797\u27b0\u27bf\u2b1b-\u2b1c\u2b50\u2b55\ufe0f\U0001f000-\U0001faff\U0001fc00-\U0001fffd\U000e0020-\U000e007f]'
    -- Invisible characters (INVISIBLE_RANGES in lib/accounts/validation.ts).
    and name !~ '[\u0001-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]'
    and lower(name) not in (
      'admin', 'administrator', 'api', 'auth', 'channel', 'flags', 'help', 'history',
      'library', 'login', 'logout', 'me', 'moderator', 'null', 'root', 'settings',
      'signup', 'sloptube', 'staff', 'subscriptions', 'support', 'system', 'trending',
      'undefined', 'upload', 'watch', 'welcome'
    );
$$;

-- The sign up trigger keeps the username as typed (it used to make it lower case).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  wanted text := btrim(meta ->> 'username');
  claimed_birthdate text := meta ->> 'birthdate';
  chosen text;
  shown text;
  picture text := meta ->> 'avatar_url';
begin
  -- Email sign up sends the birthdate along. Refuse under 13 right away so no
  -- account is created. (Google sign ups confirm it in complete_signup.)
  if claimed_birthdate ~ '^\d{4}-\d{2}-\d{2}$' then
    if public.age_on(claimed_birthdate::date) < 13 then
      raise exception 'too_young' using errcode = 'P0001';
    end if;
  end if;

  if public.username_is_valid(wanted)
     and not exists (select 1 from public.profiles p where lower(p.username) = lower(wanted)) then
    chosen := wanted;
  else
    chosen := public.generate_username(
      coalesce(nullif(meta ->> 'full_name', ''), split_part(coalesce(new.email, ''), '@', 1))
    );
  end if;

  shown := left(coalesce(nullif(meta ->> 'full_name', ''), nullif(meta ->> 'name', ''), chosen), 50);

  insert into public.profiles (id, username, display_name, avatar_url)
  values (
    new.id,
    chosen,
    shown,
    case when picture ~ '^https://' then picture else null end
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- Finishes sign up, keeping the username as typed. Same errors as before:
--   not_signed_in, invalid_username, username_taken, birthdate_required,
--   invalid_birthdate, too_young, already_complete
create or replace function public.complete_signup(username text, birthdate date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  wanted text := btrim(complete_signup.username);
  current_profile public.profiles;
begin
  if me is null then
    raise exception 'not_signed_in' using errcode = 'P0001';
  end if;

  select * into current_profile from public.profiles p where p.id = me;
  if current_profile.onboarded then
    raise exception 'already_complete' using errcode = 'P0001';
  end if;

  if complete_signup.birthdate is null then
    raise exception 'birthdate_required' using errcode = 'P0001';
  end if;
  if complete_signup.birthdate > current_date or complete_signup.birthdate < date '1900-01-01' then
    raise exception 'invalid_birthdate' using errcode = 'P0001';
  end if;
  if public.age_on(complete_signup.birthdate) < 13 then
    raise exception 'too_young' using errcode = 'P0001';
  end if;

  if not public.username_is_valid(wanted) then
    raise exception 'invalid_username' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.profiles p where lower(p.username) = lower(wanted) and p.id <> me) then
    raise exception 'username_taken' using errcode = 'P0001';
  end if;

  if current_profile.id is null then
    -- The trigger did not run (for example a user created before 002).
    insert into public.profiles (id, username, display_name, birthdate, onboarded)
    values (me, wanted, left(wanted, 50), complete_signup.birthdate, true);
  else
    update public.profiles p
       set username = wanted,
           birthdate = complete_signup.birthdate,
           onboarded = true
     where p.id = me;
  end if;
end;
$$;

revoke execute on function public.complete_signup(text, date) from public, anon;
grant execute on function public.complete_signup(text, date) to authenticated;

-- Uploads ---------------------------------------------------------------------------

-- Starts an upload for the signed in person and returns the new video id and
-- the R2 object key the file must be uploaded to:
--   uploads/<owner id>/<video id>/source.<ext>
-- Errors (the message is the code the app shows a friendly text for):
--   not_signed_in, upload_off, not_onboarded, too_young, no_channel,
--   title_invalid, file_empty, file_too_big, bad_type
create or replace function public.create_upload(title text, bytes bigint, mime text)
returns table (video_id uuid, source_key text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  me_profile public.profiles;
  my_channel uuid;
  clean_title text := trim(both from coalesce(create_upload.title, ''));
  ext text := public.video_extension_for(create_upload.mime);
  new_id uuid := gen_random_uuid();
  new_key text;
begin
  if me is null then
    raise exception 'not_signed_in' using errcode = 'P0001';
  end if;
  if not public.upload_flag_on(me) then
    raise exception 'upload_off' using errcode = 'P0001';
  end if;

  select * into me_profile from public.profiles p where p.id = me;
  if me_profile.id is null or not me_profile.onboarded or me_profile.birthdate is null then
    raise exception 'not_onboarded' using errcode = 'P0001';
  end if;
  if public.age_on(me_profile.birthdate) < 13 then
    raise exception 'too_young' using errcode = 'P0001';
  end if;

  select c.id into my_channel from public.channels c where c.owner_id = me;
  if my_channel is null then
    raise exception 'no_channel' using errcode = 'P0001';
  end if;

  if char_length(clean_title) not between 1 and 100 then
    raise exception 'title_invalid' using errcode = 'P0001';
  end if;
  if create_upload.bytes is null or create_upload.bytes < 1 then
    raise exception 'file_empty' using errcode = 'P0001';
  end if;
  if create_upload.bytes > 2147483648 then
    raise exception 'file_too_big' using errcode = 'P0001';
  end if;
  if ext is null then
    raise exception 'bad_type' using errcode = 'P0001';
  end if;

  new_key := 'uploads/' || me::text || '/' || new_id::text || '/source.' || ext;
  insert into public.videos (id, channel_id, owner_id, title, source_key, source_bytes, source_mime)
  values (new_id, my_channel, me, clean_title, new_key, create_upload.bytes, create_upload.mime);

  return query select new_id, new_key;
end;
$$;

revoke execute on function public.create_upload(text, bigint, text) from public, anon;
grant execute on function public.create_upload(text, bigint, text) to authenticated;
