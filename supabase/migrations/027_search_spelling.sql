-- 027_search_spelling.sql
-- Spelling correction for search, like 2020: "Showing results for <fixed>,
-- Search instead for <typed>" when what was typed finds nothing, and "Did you
-- mean: <fixed>" above the results when it finds something.
--
-- - public.search_words: every word (3 to 30 letters or digits, not only
--   digits) in the titles and tags of public, ready videos and in channel
--   names and handles, with how often it appears. Nobody reads it through the
--   API. refresh_search_words() rebuilds it: once here, then every 30 minutes
--   with pg_cron (a notice says so when pg_cron is not switched on).
-- - search_spelling(q): the query with each unknown word replaced by the
--   closest known word, or null when nothing changes. A known word is close
--   when it is one edit away (two for words of 5 letters or more), the same
--   letters with two swapped, or very similar by trigrams; the fewest edits
--   win, then the same first letter, then the most similar, then the most
--   common. Words under 3 letters, numbers and known words stay as they are.
--   Counts toward the 240 a minute of the suggest bucket. Uses fuzzystrmatch
--   (in the extensions schema) for the edit distance.
-- - the search_spelling flag (off).
--
-- Run after 026_shortcuts_hover.sql (needs 010_search.sql). Safe to run more
-- than once.

create extension if not exists fuzzystrmatch with schema extensions;

create table if not exists public.search_words (
  word text primary key,
  freq int not null default 1
);

create index if not exists search_words_trgm_idx on public.search_words using gin (word extensions.gin_trgm_ops);

alter table public.search_words enable row level security;
revoke all on public.search_words from anon, authenticated;

create or replace function public.refresh_search_words()
returns int
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  n int;
begin
  create temporary table if not exists search_words_next (word text primary key, freq int not null) on commit drop;
  truncate search_words_next;

  insert into search_words_next (word, freq)
  select w, count(*)::int
  from (
    select regexp_split_to_table(
             lower(v.title || ' ' || coalesce(array_to_string(v.tags, ' '), '')),
             '[^[:alnum:]]+'
           ) as w
      from public.videos v
     where v.visibility = 'public' and v.status = 'ready'
    union all
    select regexp_split_to_table(lower(coalesce(c.name, '') || ' ' || coalesce(c.handle, '')), '[^[:alnum:]]+')
      from public.channels c
  ) words
  where length(w) between 3 and 30 and w !~ '^[0-9]+$'
  group by w;

  delete from public.search_words s where not exists (select 1 from search_words_next n where n.word = s.word);
  insert into public.search_words (word, freq)
  select word, freq from search_words_next
  on conflict (word) do update set freq = excluded.freq where public.search_words.freq is distinct from excluded.freq;

  select count(*) into n from public.search_words;
  return n;
end;
$$;

revoke execute on function public.refresh_search_words() from public, anon, authenticated;

select public.refresh_search_words();

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'refresh-search-words';
    perform cron.schedule('refresh-search-words', '*/30 * * * *', 'select public.refresh_search_words()');
  else
    raise notice 'pg_cron is not switched on: run select public.refresh_search_words(); now and then, or switch on pg_cron and run this file again.';
  end if;
end;
$$;

-- The letters of a word in order: "rign" and "ring" are both "ginr", so a
-- swap of two letters counts as close even in short words.
create or replace function public.search_letters(w text)
returns text
language sql
immutable
set search_path = ''
as $$ select string_agg(ch, '' order by ch) from regexp_split_to_table(w, '') as ch $$;

create or replace function public.search_spelling(q text)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  clean text := public.search_normalize(q);
  w text;
  best text;
  changed boolean := false;
  words text[] := '{}';
begin
  if clean = '' then
    return null;
  end if;
  perform public.search_throttle('suggest');

  foreach w in array regexp_split_to_array(clean, ' ') loop
    continue when w = '';
    best := null;
    if length(w) >= 3 and length(w) <= 30 and w !~ '^[0-9]+$' and w ~ '^[[:alnum:]]+$'
       and not exists (select 1 from public.search_words s where s.word = w) then
      select c.word into best
        from (
          select s.word,
                 s.freq,
                 extensions.levenshtein(s.word, w) as d,
                 extensions.similarity(s.word, w) as sim
            from public.search_words s
           where abs(length(s.word) - length(w)) <= 2
             and (s.word operator(extensions.%) w or extensions.levenshtein_less_equal(s.word, w, 2) <= 2)
        ) c
       where c.d <= case when length(w) <= 4 then 1 else 2 end
          or (c.d = 2 and length(c.word) = length(w) and public.search_letters(c.word) = public.search_letters(w))
          or c.sim >= 0.45
       order by c.d, (left(c.word, 1) = left(w, 1)) desc, c.sim desc, c.freq desc, c.word
       limit 1;
    end if;
    if best is not null and best <> w then
      words := words || best;
      changed := true;
    else
      words := words || w;
    end if;
  end loop;

  if not changed then
    return null;
  end if;
  return array_to_string(words, ' ');
end;
$$;

revoke execute on function public.search_spelling(text) from public;
grant execute on function public.search_spelling(text) to anon, authenticated;

insert into public.feature_flags (key, label, description, mode)
values (
  'search_spelling',
  'Search spelling correction',
  'When a search finds nothing, results for the closest known spelling show with "Showing results for" and "Search instead for"; otherwise "Did you mean" links to it.',
  'off'
)
on conflict (key) do nothing;
