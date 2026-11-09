-- 035_bots_at_once.sql
-- Bot orders of any size, added all at once. An order placed "all at once"
-- (over_minutes 0) gets its views, likes, dislikes and subscribers in the same
-- call that places it, in about a second; only its comments come from the
-- worker a few seconds later (they are written from the video's captions).
-- Orders spread over an hour, a day or a week still go a little every minute.
-- There is no limit of our own on the amounts any more (only the 2 billion an
-- int column holds).
--
-- How a big amount stays quick and keeps the database small:
-- - the first 20,000 views of an order are full views of their own (a
--   view_events row with a watch time, a traffic source and a country, so
--   Analytics shows them); views beyond that are added to the video's count
--   (which Trending and every page use) without a row each;
-- - likes, dislikes and subscribers come from bot accounts, up to 2,000 a call
--   and as many accounts as there are; the rest are added to the counts.
--
-- - bot_deliver(order_id, views, likes, dislikes, subscribers): adds that much
--   of an order (never more than is left), records it, answers what it added.
--   Called by bot_order_add() for "all at once" and by the worker for the
--   others. Service role only.
-- - bot_order_add(): the same arguments, no limits but 2,000,000,000 an amount
--   and 500 running orders a channel; "all at once" is delivered right away.
--
-- Run after 034_bot_panel.sql. Safe to run more than once.

drop function if exists public.bot_deliver(uuid, bigint, bigint, bigint, bigint);
create function public.bot_deliver(order_id uuid, views bigint, likes bigint, dislikes bigint, subscribers bigint)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  o public.bot_orders;
  v public.videos;
  sources text[] := array['home', 'home', 'home', 'search', 'subscriptions', 'channel', 'other', 'external'];
  n_views bigint;
  n_likes bigint;
  n_dislikes bigint;
  n_subs bigint;
  full_views int := 0;
  real_likes int := 0;
  real_dislikes int := 0;
  real_subs int := 0;
begin
  select * into o from public.bot_orders b where b.id = bot_deliver.order_id and b.status = 'active' for update;
  if o.id is null then
    return null;
  end if;
  n_views := least(greatest(coalesce(bot_deliver.views, 0), 0), o.views - o.done_views);
  n_likes := least(greatest(coalesce(bot_deliver.likes, 0), 0), o.likes - o.done_likes);
  n_dislikes := least(greatest(coalesce(bot_deliver.dislikes, 0), 0), o.dislikes - o.done_dislikes);
  n_subs := least(greatest(coalesce(bot_deliver.subscribers, 0), 0), o.subscribers - o.done_subscribers);

  if o.video_id is not null and n_views + n_likes + n_dislikes > 0 then
    select * into v from public.videos x
     where x.id = o.video_id and x.status = 'ready' and x.visibility in ('public', 'unlisted')
       and x.deleted_at is null and x.removed_at is null;
    if v.id is null then
      return null;
    end if;
    -- A Premiere or live broadcast that has not started gets no views yet.
    if v.broadcast_at is not null and v.broadcast_at > now() then
      n_views := 0;
    end if;

    full_views := least(n_views, greatest(0, 20000 - o.done_views))::int;
    if full_views > 0 then
      insert into public.view_events (video_id, viewer_key, day, watched_s, counted, counted_at, reached, source, first_at, last_at)
      select v.id, 'bot:' || gen_random_uuid()::text, (now() at time zone 'utc')::date, g.w, true, now(),
             public.stats_reached(0, 0, g.w, v.duration_s),
             sources[1 + floor(random() * array_length(sources, 1))::int],
             now() - make_interval(secs => g.w), now()
        from (
          select greatest(10, floor(coalesce(v.duration_s, 60) * (0.25 + random() * 0.7))::int) as w
            from generate_series(1, full_views)
        ) g;
    end if;
    if n_views > 0 then
      update public.videos x set views = x.views + n_views where x.id = v.id;
    end if;

    if n_likes > 0 then
      insert into public.video_reactions (user_id, video_id, kind)
      select b.user_id, v.id, 'like'
        from public.bot_accounts b
       where not exists (select 1 from public.video_reactions r where r.user_id = b.user_id and r.video_id = v.id)
       order by random()
       limit least(n_likes, 2000)
      on conflict do nothing;
      get diagnostics real_likes = row_count;
      if n_likes > real_likes then
        update public.videos x set like_count = x.like_count + (n_likes - real_likes) where x.id = v.id;
      end if;
    end if;

    if n_dislikes > 0 then
      insert into public.video_reactions (user_id, video_id, kind)
      select b.user_id, v.id, 'dislike'
        from public.bot_accounts b
       where not exists (select 1 from public.video_reactions r where r.user_id = b.user_id and r.video_id = v.id)
       order by random()
       limit least(n_dislikes, 2000)
      on conflict do nothing;
      get diagnostics real_dislikes = row_count;
      if n_dislikes > real_dislikes then
        insert into public.video_dislike_counts as d (video_id, dislike_count)
        values (v.id, n_dislikes - real_dislikes)
        on conflict (video_id) do update set dislike_count = d.dislike_count + (n_dislikes - real_dislikes);
      end if;
    end if;
  end if;

  if n_subs > 0 then
    insert into public.subscriptions (subscriber_id, channel_id)
    select b.user_id, o.channel_id
      from public.bot_accounts b
     where not exists (select 1 from public.subscriptions s where s.subscriber_id = b.user_id and s.channel_id = o.channel_id)
     order by random()
     limit least(n_subs, 2000)
    on conflict do nothing;
    get diagnostics real_subs = row_count;
    if n_subs > real_subs then
      update public.channels c
         set subscriber_count = least(2147483647, c.subscriber_count::bigint + (n_subs - real_subs))::int
       where c.id = o.channel_id;
    end if;
  end if;

  update public.bot_orders b
     set done_views = b.done_views + n_views,
         done_likes = b.done_likes + n_likes,
         done_dislikes = b.done_dislikes + n_dislikes,
         done_subscribers = b.done_subscribers + n_subs
   where b.id = o.id
  returning * into o;
  if o.done_views >= o.views and o.done_likes >= o.likes and o.done_dislikes >= o.dislikes
     and o.done_comments >= o.comments and o.done_subscribers >= o.subscribers then
    update public.bot_orders b set status = 'done', finished_at = now() where b.id = o.id;
  end if;
  return jsonb_build_object(
    'views', n_views, 'likes', n_likes, 'dislikes', n_dislikes, 'subscribers', n_subs,
    'full_views', full_views, 'real_likes', real_likes, 'real_dislikes', real_dislikes, 'real_subscribers', real_subs
  );
end;
$$;

drop function if exists public.bot_order_add(uuid, int, int, int, int, int, int);
create function public.bot_order_add(
  video_id uuid,
  views int,
  likes int,
  dislikes int,
  comments int,
  subscribers int,
  over_minutes int
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  ch public.channels := public.bot_owner_channel();
  v public.videos;
  w int := coalesce(over_minutes, 0);
  new_id uuid;
begin
  if coalesce(views, 0) not between 0 and 2000000000
     or coalesce(likes, 0) not between 0 and 2000000000
     or coalesce(dislikes, 0) not between 0 and 2000000000
     or coalesce(comments, 0) not between 0 and 2000000000
     or coalesce(subscribers, 0) not between 0 and 2000000000 then
    raise exception 'bad_amount' using errcode = 'P0001';
  end if;
  if w not in (0, 60, 1440, 10080) then
    raise exception 'bad_window' using errcode = 'P0001';
  end if;
  if bot_order_add.video_id is null then
    if coalesce(views, 0) + coalesce(likes, 0) + coalesce(dislikes, 0) + coalesce(comments, 0) > 0 then
      raise exception 'not_found' using errcode = 'P0001';
    end if;
  else
    select * into v from public.videos x where x.id = bot_order_add.video_id and x.channel_id = ch.id and x.deleted_at is null;
    if v.id is null then
      raise exception 'not_found' using errcode = 'P0001';
    end if;
    if v.status <> 'ready' then
      raise exception 'not_ready' using errcode = 'P0001';
    end if;
    if v.visibility not in ('public', 'unlisted') or v.removed_at is not null then
      raise exception 'not_public' using errcode = 'P0001';
    end if;
  end if;
  if coalesce(views, 0)::bigint + coalesce(likes, 0) + coalesce(dislikes, 0) + coalesce(comments, 0) + coalesce(subscribers, 0) = 0 then
    raise exception 'empty_order' using errcode = 'P0001';
  end if;
  if (select count(*) from public.bot_orders b where b.channel_id = ch.id and b.status = 'active') >= 500 then
    raise exception 'too_many_orders' using errcode = 'P0001';
  end if;
  insert into public.bot_orders (channel_id, video_id, views, likes, dislikes, comments, subscribers, starts_at, ends_at, created_by)
  values (
    ch.id, bot_order_add.video_id,
    coalesce(views, 0), coalesce(likes, 0), coalesce(dislikes, 0), coalesce(comments, 0), coalesce(subscribers, 0),
    now(), now() + make_interval(mins => w), auth.uid()
  )
  returning id into new_id;
  -- All at once: everything but the comments, now.
  if w = 0 then
    perform public.bot_deliver(new_id, coalesce(views, 0), coalesce(likes, 0), coalesce(dislikes, 0), coalesce(subscribers, 0));
  end if;
  return new_id;
end;
$$;

revoke execute on function public.bot_deliver(uuid, bigint, bigint, bigint, bigint) from public, anon, authenticated;
grant execute on function public.bot_deliver(uuid, bigint, bigint, bigint, bigint) to service_role;
revoke execute on function public.bot_order_add(uuid, int, int, int, int, int, int) from public, anon;
grant execute on function public.bot_order_add(uuid, int, int, int, int, int, int) to authenticated;
