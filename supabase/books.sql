-- Footnotes · Books shelf
-- Run once in the Supabase SQL editor. Until then the Books page saves to this
-- device only; local books are uploaded automatically the first time the
-- table is reachable.

create table if not exists public.books (
  id text primary key,
  user_id uuid default auth.uid() references auth.users(id) on delete cascade not null,
  title text not null,
  author text default '' not null,
  year integer,
  isbn text,
  pages integer,
  cover_url text default '' not null,
  source_key text,
  status text default 'want' not null check (status in ('want', 'reading', 'read', 'abandoned')),
  rating numeric(2, 1) default 0 not null check (rating >= 0 and rating <= 5),
  review text default '' not null,
  tags jsonb default '[]'::jsonb not null,
  started_on date,
  finished_on date,
  added_at bigint not null,
  updated_at bigint not null
);

create index if not exists books_user_added_idx on public.books (user_id, added_at desc);

alter table public.books enable row level security;

drop policy if exists "Users can perform all actions on their own books" on public.books;
create policy "Users can perform all actions on their own books"
  on public.books for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
