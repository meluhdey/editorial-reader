-- Footnotes · Newsletter "read" status
-- Run once in the Supabase SQL editor (after newsletters.sql).
-- Adds read_at and lets you update only that column on your own issues.

alter table public.newsletters add column if not exists read_at bigint;

revoke update on public.newsletters from authenticated;
grant update (read_at) on public.newsletters to authenticated;

drop policy if exists "Users can mark their own newsletters read" on public.newsletters;
create policy "Users can mark their own newsletters read"
  on public.newsletters for update to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

notify pgrst, 'reload schema';
