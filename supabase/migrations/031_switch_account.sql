-- 031_switch_account.sql
-- Several channels under one login, like 2020's "Switch account" (the
-- switch_account flag). Each extra channel is an account of its own (a
-- profile and a channel, made by the site with the service role, with no
-- password and no way to sign in directly), linked to the main account. From
-- any account in the group you can switch to any other: the site checks the
-- link, then signs you in as that account. Comments, likes and subscriptions
-- are then that channel's own, like 2020.
--
-- - public.account_links (member, owner), not readable through the API.
-- - account_group(uid): the main account of uid's group (uid itself when it is
--   the main one or alone).
-- - my_accounts(): every account in the caller's group, the main one first.
-- - can_switch_to(target): true when target is in the caller's group (and the
--   flag is on for the group).
-- - link_channel_account(owner, member) for the site (service role only):
--   links a new account to owner's group (at most 20 extra channels), and
--   copies the main account's birthdate so the new one is signed up already.
--
-- Run after 030_bots.sql. Safe to run more than once.

create table if not exists public.account_links (
  member_id uuid primary key references public.profiles (id) on delete cascade,
  owner_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint account_links_not_self check (member_id <> owner_id)
);

create index if not exists account_links_owner_idx on public.account_links (owner_id);

alter table public.account_links enable row level security;
revoke all on public.account_links from anon, authenticated;

create or replace function public.account_group(uid uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select l.owner_id from public.account_links l where l.member_id = uid), uid);
$$;

drop function if exists public.my_accounts();
create function public.my_accounts()
returns table (
  id uuid,
  username text,
  display_name text,
  avatar_url text,
  handle text,
  channel_name text,
  subscriber_count int,
  is_current boolean,
  is_main boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with g as (select public.account_group(auth.uid()) as owner)
  select p.id, p.username, coalesce(nullif(p.display_name, ''), p.username), p.avatar_url,
         c.handle, coalesce(nullif(c.name, ''), c.handle), coalesce(c.subscriber_count, 0),
         p.id = auth.uid(), p.id = g.owner
    from g
    join public.profiles p
      on p.id = g.owner or p.id in (select l.member_id from public.account_links l where l.owner_id = g.owner)
    left join public.channels c on c.owner_id = p.id
   where auth.uid() is not null
   order by p.id = g.owner desc, p.created_at, p.id;
$$;

drop function if exists public.can_switch_to(uuid);
create function public.can_switch_to(target uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
     and target is not null
     and target <> auth.uid()
     and (public.feature_on('switch_account', auth.uid()) or public.feature_on('switch_account', public.account_group(auth.uid())))
     and public.account_group(target) = public.account_group(auth.uid())
     and not exists (select 1 from public.profiles p where p.id = target and p.banned_at is not null);
$$;

drop function if exists public.link_channel_account(uuid, uuid);
create function public.link_channel_account(owner uuid, member uuid)
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
end;
$$;

revoke execute on function public.account_group(uuid) from public, anon, authenticated;
revoke execute on function public.my_accounts() from public, anon;
revoke execute on function public.can_switch_to(uuid) from public, anon;
revoke execute on function public.link_channel_account(uuid, uuid) from public, anon, authenticated;
grant execute on function public.my_accounts() to authenticated;
grant execute on function public.can_switch_to(uuid) to authenticated;
grant execute on function public.link_channel_account(uuid, uuid) to service_role;

insert into public.feature_flags (key, label, description, mode)
values (
  'switch_account',
  'Switch account',
  'Several channels under one login: Switch account in the account menu and /account/switcher to make another channel. Needs SUPABASE_SERVICE_ROLE_KEY on the website.',
  'off'
)
on conflict (key) do nothing;
