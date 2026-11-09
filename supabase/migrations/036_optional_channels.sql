-- 036_optional_channels.sql
-- A channel is a choice, like 2020's "Create a channel" (the optional_channels
-- flag). Until now every new account got a channel at sign up (004's trigger).
-- With the flag set to everyone, new accounts start without one: they can
-- watch, like, subscribe and comment as their account, and make a channel from
-- the account menu when they want one (uploading, the studio and going live
-- ask for it). Channels that exist stay.
--
-- - handle_new_profile() makes no channel for a new account while the flag is
--   everyone, and never for a bot account (030).
-- - Bot accounts lose their channels (the ones without videos), so they stop
--   showing up as channels in search.
-- - create_my_channel(name, handle): the caller's channel, once. The handle is
--   made from the username when it is empty. Answers the handle.
--   Errors: not_signed_in, banned, has_channel, bad_name, handle_invalid,
--   handle_reserved, handle_taken.
-- - link_channel_account (031) gives the new account its channel itself.
-- - comment_cards: author_handle is the author's channel handle, null when the
--   author has no channel (the page shows the name without a link); the name
--   and picture still come from the account.
--
-- Run after 035_bots_at_once.sql. Safe to run more than once.

create or replace function public.handle_new_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Bot accounts (bot_grow in 034) never get a channel.
  if exists (select 1 from auth.users u where u.id = new.id and u.email like 'bot-%@users.invalid') then
    return new;
  end if;
  -- With optional channels on for everyone, a channel waits for "Create a channel".
  if exists (select 1 from public.feature_flags f where f.key = 'optional_channels' and f.mode = 'everyone') then
    return new;
  end if;
  insert into public.channels (owner_id, handle, name, avatar_url)
  values (
    new.id,
    public.generate_channel_handle(new.username),
    left(coalesce(nullif(new.display_name, ''), new.username), 50),
    new.avatar_url
  )
  on conflict (owner_id) do nothing;
  return new;
end;
$$;

-- Bot accounts do not need channels.
delete from public.channels c
 using public.bot_accounts b
 where c.owner_id = b.user_id
   and not exists (select 1 from public.videos v where v.channel_id = c.id);

drop function if exists public.create_my_channel(text, text);
create function public.create_my_channel(name text, handle text default null)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  p public.profiles;
  clean_name text := btrim(coalesce(create_my_channel.name, ''));
  wanted text := lower(btrim(regexp_replace(coalesce(create_my_channel.handle, ''), '^\s*@', '')));
  problem text;
  block text;
begin
  if me is null then
    raise exception 'not_signed_in' using errcode = 'P0001';
  end if;
  block := public.moderation_block_for(me);
  if block is not null then
    raise exception '%', block using errcode = 'P0001';
  end if;
  if exists (select 1 from public.channels c where c.owner_id = me) then
    raise exception 'has_channel' using errcode = 'P0001';
  end if;
  select * into p from public.profiles x where x.id = me;
  if p.id is null then
    raise exception 'not_signed_in' using errcode = 'P0001';
  end if;
  if clean_name = '' then
    clean_name := left(coalesce(nullif(p.display_name, ''), p.username), 50);
  end if;
  if char_length(clean_name) not between 1 and 50 then
    raise exception 'bad_name' using errcode = 'P0001';
  end if;
  if wanted = '' then
    wanted := public.generate_channel_handle(p.username);
  else
    problem := public.channel_handle_problem(wanted);
    if problem = 'reserved' then
      raise exception 'handle_reserved' using errcode = 'P0001';
    elsif problem is not null then
      raise exception 'handle_invalid' using errcode = 'P0001', detail = problem;
    end if;
    if exists (select 1 from public.channels c where lower(c.handle) = wanted) then
      raise exception 'handle_taken' using errcode = 'P0001';
    end if;
  end if;
  begin
    insert into public.channels (owner_id, handle, name, avatar_url)
    values (me, wanted, clean_name, p.avatar_url);
  exception when unique_violation then
    if exists (select 1 from public.channels c where c.owner_id = me) then
      raise exception 'has_channel' using errcode = 'P0001';
    end if;
    raise exception 'handle_taken' using errcode = 'P0001';
  end;
  return wanted;
end;
$$;

revoke execute on function public.create_my_channel(text, text) from public, anon;
grant execute on function public.create_my_channel(text, text) to authenticated;

-- 031's link, now making the new account's channel itself.
create or replace function public.link_channel_account(owner uuid, member uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  main uuid := public.account_group(owner);
begin
  if main is null or member is null or member = main then
    raise exception 'bad_request' using errcode = 'P0001';
  end if;
  if (select count(*) from public.account_links l where l.owner_id = main) >= 20 then
    raise exception 'too_many_channels' using errcode = 'P0001';
  end if;
  insert into public.account_links (member_id, owner_id) values (member, main)
  on conflict (member_id) do nothing;
  update public.profiles p
     set birthdate = (select m.birthdate from public.profiles m where m.id = main),
         onboarded = true
   where p.id = member;
  insert into public.channels (owner_id, handle, name, avatar_url)
  select p.id, public.generate_channel_handle(p.username), left(coalesce(nullif(p.display_name, ''), p.username), 50), p.avatar_url
    from public.profiles p
   where p.id = member
  on conflict (owner_id) do nothing;
end;
$$;

revoke execute on function public.link_channel_account(uuid, uuid) from public, anon, authenticated;
grant execute on function public.link_channel_account(uuid, uuid) to service_role;

-- 016's view: the same columns, author_handle only for authors with a channel.
create or replace view public.comment_cards
with (security_invoker = true)
as
select
  c.id,
  c.video_id,
  c.parent_id,
  case when c.deleted_at is null then c.body end as body,
  c.like_count,
  c.reply_count,
  c.pinned,
  c.hearted and c.deleted_at is null as hearted,
  c.created_at,
  c.edited_at,
  c.deleted_at is not null as deleted,
  case when c.deleted_at is null then ch.handle end as author_handle,
  case when c.deleted_at is null then coalesce(nullif(ch.name, ''), nullif(p.display_name, ''), p.username) end as author_name,
  case when c.deleted_at is null then coalesce(ch.avatar_url, p.avatar_url) end as author_avatar_url,
  c.author_id = v.owner_id and c.deleted_at is null as by_owner,
  c.author_id = (select auth.uid()) as mine,
  exists (
    select 1 from public.comment_likes l where l.comment_id = c.id and l.user_id = (select auth.uid())
  ) as liked,
  c.removed_at is not null as removed
from public.comments c
join public.videos v on v.id = c.video_id
join public.profiles p on p.id = c.author_id
left join public.channels ch on ch.owner_id = c.author_id;

revoke all on public.comment_cards from public, anon, authenticated;

insert into public.feature_flags (key, label, description, mode)
values (
  'optional_channels',
  'Optional channels',
  'New accounts start without a channel and make one with "Create a channel" in the account menu (uploading, the studio and going live ask for it). Off: every new account gets a channel at sign up, as before. Bot accounts never get one.',
  'off'
)
on conflict (key) do nothing;
