-- 0056_community_rls.sql
-- Strict RLS for the Community v1 tables (0055), following 0053's established
-- shapes exactly: owner-only for tables with their own user_id, public-read
-- gated by a moderation predicate for content that other users must see, and
-- no-policy-at-all for the internal audit table. Kept in its own migration
-- (not folded into 0053) since 0053's leading step drops every policy on every
-- public table — re-running it would otherwise nuke these too if they lived
-- there instead.
--
-- As with 0053: the Express API always writes via the service-role key
-- (bypasses RLS) after scoping by the token-derived currentUserId(), so this
-- is defense-in-depth, not the app's actual authorization mechanism.

alter table public.discussion_threads enable row level security;
alter table public.discussion_posts enable row level security;
alter table public.post_votes enable row level security;
alter table public.shared_answers enable row level security;
alter table public.reports enable row level security;
alter table public.user_blocks enable row level security;
alter table public.post_screenings enable row level security;

-- ---------------------------------------------------------------------------
-- discussion_threads — visible to everyone once not flagged/removed, or always
-- to its own author; owner can insert/update (rename) their own thread.
-- ---------------------------------------------------------------------------
create policy content_read on public.discussion_threads
  for select to authenticated
  using (moderation_status = 'visible' or user_id = auth.uid());
create policy owner_insert on public.discussion_threads
  for insert to authenticated with check (auth.uid() = user_id);
create policy owner_update on public.discussion_threads
  for update to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- discussion_posts — same visibility shape as threads, scoped through the
-- parent thread so a removed thread hides its posts even if a post row itself
-- is still 'visible'. Owner can insert/update (edit body, soft-delete).
-- ---------------------------------------------------------------------------
create policy content_read on public.discussion_posts
  for select to authenticated
  using (
    (moderation_status = 'visible' or user_id = auth.uid())
    and exists (
      select 1 from public.discussion_threads t
      where t.id = thread_id and t.moderation_status <> 'removed'
    )
  );
create policy owner_insert on public.discussion_posts
  for insert to authenticated with check (auth.uid() = user_id);
create policy owner_update on public.discussion_posts
  for update to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- post_votes — plain owner-only (0053 §2 shape): a user only ever needs to see
-- their own cast votes (e.g. "did I already vote on this post").
-- ---------------------------------------------------------------------------
create policy owner_select on public.post_votes
  for select to authenticated using (auth.uid() = user_id);
create policy owner_insert on public.post_votes
  for insert to authenticated with check (auth.uid() = user_id);
create policy owner_update on public.post_votes
  for update to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy owner_delete on public.post_votes
  for delete to authenticated using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- shared_answers — public read (the peer-review feed), owner-only write.
-- ---------------------------------------------------------------------------
create policy content_read on public.shared_answers
  for select to authenticated using (true);
create policy owner_insert on public.shared_answers
  for insert to authenticated with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- reports — write-only for regular users (insert their own report); no select
-- policy, so only the service role (the admin Reports queue) can read them.
-- ---------------------------------------------------------------------------
create policy owner_insert on public.reports
  for insert to authenticated with check (auth.uid() = reporter_id);

-- ---------------------------------------------------------------------------
-- user_blocks — owner-only via blocker_id; create/read/delete, no update
-- (a block is toggled off by deleting the row, never edited in place).
-- ---------------------------------------------------------------------------
create policy owner_select on public.user_blocks
  for select to authenticated using (auth.uid() = blocker_id);
create policy owner_insert on public.user_blocks
  for insert to authenticated with check (auth.uid() = blocker_id);
create policy owner_delete on public.user_blocks
  for delete to authenticated using (auth.uid() = blocker_id);

-- ---------------------------------------------------------------------------
-- post_screenings — internal only. RLS on, no policy at all: anon and
-- authenticated are fully denied; only the service role reaches it.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 0053 leaves users_profile owner-only-select (auth.uid() = id) — community
-- needs OTHER users' handle/display_name to render post/thread authors.
-- Expose a narrow view instead of widening the table's own RLS (keeps
-- target_exam_year/study_hours_per_day/plan private). Deliberately WITHOUT
-- security_invoker: this view is owned by the migration role (which bypasses
-- RLS), so it evaluates against the underlying table unfiltered by the
-- querying user's row-level policy and just projects these three safe
-- columns — security_invoker=true would instead re-apply users_profile's
-- owner-only policy per caller and make the view show nothing but your own row.
-- ---------------------------------------------------------------------------
create or replace view public.community_authors as
  select id, handle, display_name
  from public.users_profile;

grant select on public.community_authors to anon, authenticated;
