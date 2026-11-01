-- Footnotes · Newsletter (daily briefing) storage
-- Run once in the Supabase SQL editor.
--
-- The 7am Claude routine posts each briefing to the ingest_newsletter() function
-- below, authenticated by a shared secret token. The routine never holds a
-- Supabase service key: the function can only add or replace newsletters for
-- the one account configured in step 2.

-- 1. Table + row-level security (you can read and delete your own issues)
create table if not exists public.newsletters (
  id text primary key default gen_random_uuid()::text,
  user_id uuid references auth.users(id) on delete cascade not null,
  issue_date date not null,
  title text not null,
  headline text default '' not null,
  summary text default '' not null,
  cover_url text default '' not null,
  cover_source_url text,
  content text not null,
  word_count integer default 0 not null,
  created_at bigint not null,
  unique (user_id, issue_date)
);

alter table public.newsletters enable row level security;

drop policy if exists "Users can read their own newsletters" on public.newsletters;
create policy "Users can read their own newsletters"
  on public.newsletters for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users can delete their own newsletters" on public.newsletters;
create policy "Users can delete their own newsletters"
  on public.newsletters for delete to authenticated
  using (auth.uid() = user_id);

-- Ingest config lives in a schema the public API can't see.
create schema if not exists private;
create table if not exists private.newsletter_ingest (
  id integer primary key default 1 check (id = 1),
  token_hash text not null,
  user_id uuid not null references auth.users(id) on delete cascade
);

-- 2. Set the token and the account the newsletters belong to.
--    Replace PASTE_YOUR_TOKEN_HERE with the token you generated, and the email
--    with the one you sign in to Footnotes with. Only a hash of the token is stored.
insert into private.newsletter_ingest (id, token_hash, user_id)
select 1, encode(extensions.digest('PASTE_YOUR_TOKEN_HERE', 'sha256'), 'hex'), id
from auth.users
where lower(email) = lower('melodywong@outlook.com')
on conflict (id) do update set token_hash = excluded.token_hash, user_id = excluded.user_id;

-- 3. The ingest function the routine calls (POST /rest/v1/rpc/ingest_newsletter).
--    Re-posting the same issue_date replaces that day's issue.
create or replace function public.ingest_newsletter(
  p_token text,
  p_issue_date date,
  p_title text,
  p_headline text,
  p_summary text,
  p_cover_url text,
  p_cover_source_url text,
  p_content text
) returns text
language plpgsql
security definer
set search_path = public, private, extensions
as $$
declare
  cfg private.newsletter_ingest;
  v_id text;
begin
  select * into cfg from private.newsletter_ingest where id = 1;
  if cfg.token_hash is null
     or cfg.token_hash <> encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex') then
    raise exception 'invalid newsletter token' using errcode = '28000';
  end if;
  if coalesce(trim(p_content), '') = '' then
    raise exception 'newsletter content is empty';
  end if;

  insert into public.newsletters
    (user_id, issue_date, title, headline, summary, cover_url, cover_source_url, content, word_count, created_at)
  values
    (cfg.user_id, p_issue_date, coalesce(p_title, ''), coalesce(p_headline, ''), coalesce(p_summary, ''),
     coalesce(p_cover_url, ''), p_cover_source_url, p_content,
     array_length(regexp_split_to_array(trim(p_content), '\s+'), 1),
     (extract(epoch from now()) * 1000)::bigint)
  on conflict (user_id, issue_date) do update set
    title = excluded.title,
    headline = excluded.headline,
    summary = excluded.summary,
    cover_url = excluded.cover_url,
    cover_source_url = excluded.cover_source_url,
    content = excluded.content,
    word_count = excluded.word_count,
    created_at = excluded.created_at
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.ingest_newsletter(text, date, text, text, text, text, text, text) from public;
grant execute on function public.ingest_newsletter(text, date, text, text, text, text, text, text) to anon, authenticated;

-- Make the new function visible to the API straight away.
notify pgrst, 'reload schema';
