-- 0055_community.sql
-- COMMUNITY v1 — discussion threads attached to content, and peer review of
-- shared answers. Public identity is the `handle` chosen at onboarding
-- (migration 0052) / display_name; real emails never render anywhere here.
--
-- Anchors are polymorphic (question | node | ca_item | shared_answer), so
-- anchor_id carries no FK — same "FK by convention" idiom as srs_cards.source_id
-- and embeddings' source_id, since a single uuid column can't reference four
-- different tables.
--
-- Moderation: every thread/post starts `visible` (optimistic — the author sees
-- it immediately) and is screened asynchronously by a cheap claude-haiku-4-5
-- classifier (apps/api/src/lib/community-moderation.ts) right after creation;
-- a positive hit flips moderation_status to `flagged`, which the content_read
-- policy (0056) and every list query already exclude. `removed` is admin-only
-- (via the Reports queue). post_screenings is the append-only audit trail of
-- every screen run, internal-only (no RLS policy — service role only), mirroring
-- llm_calls/generation_batches.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type discussion_anchor_type as enum ('question', 'node', 'ca_item', 'shared_answer');
create type moderation_status as enum ('visible', 'flagged', 'removed');
create type report_target_type as enum ('thread', 'post');
create type report_reason as enum ('spam', 'abuse', 'harassment', 'off_topic', 'pii', 'other');
create type report_status as enum ('open', 'actioned', 'dismissed');

-- ---------------------------------------------------------------------------
-- discussion_threads
-- ---------------------------------------------------------------------------
create table public.discussion_threads (
  id                uuid primary key default gen_random_uuid(),
  anchor_type       discussion_anchor_type not null,
  anchor_id         uuid not null,
  title             text not null,
  user_id           uuid not null references public.users_profile(id) on delete cascade,
  is_locked         boolean not null default false,
  moderation_status moderation_status not null default 'visible',
  -- Denormalized via the discussion_posts_after_write trigger below — cheap
  -- "recent activity" sort for the community hub without a per-row join/count.
  post_count        int not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

comment on table public.discussion_threads is
  'A discussion attached to a question, syllabus node, current-affairs item, or shared answer. anchor_id has no FK (polymorphic across 4 tables) — same convention as srs_cards.source_id.';

create index discussion_threads_anchor_idx
  on public.discussion_threads (anchor_type, anchor_id, updated_at desc);
create index discussion_threads_user_idx on public.discussion_threads (user_id, created_at desc);
create index discussion_threads_recent_idx
  on public.discussion_threads (updated_at desc)
  where moderation_status = 'visible';

create trigger discussion_threads_set_updated_at
  before update on public.discussion_threads
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- discussion_posts
-- ---------------------------------------------------------------------------
create table public.discussion_posts (
  id                uuid primary key default gen_random_uuid(),
  thread_id         uuid not null references public.discussion_threads(id) on delete cascade,
  user_id           uuid not null references public.users_profile(id) on delete cascade,
  body              text not null,
  moderation_status moderation_status not null default 'visible',
  is_deleted        boolean not null default false,
  vote_score        int not null default 0,
  edited_at         timestamptz,
  created_at        timestamptz not null default now()
);

create index discussion_posts_thread_idx on public.discussion_posts (thread_id, created_at);
create index discussion_posts_user_idx on public.discussion_posts (user_id, created_at desc);

-- Keep discussion_threads.post_count / updated_at in sync with its posts —
-- cheaper than a per-list COUNT(*) join, and "updated_at desc" doubles as the
-- hub's "recent activity" sort key.
create or replace function public.discussion_posts_after_write()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    update public.discussion_threads
      set post_count = post_count + 1, updated_at = now()
      where id = new.thread_id;
    return new;
  elsif tg_op = 'DELETE' then
    update public.discussion_threads
      set post_count = greatest(0, post_count - 1)
      where id = old.thread_id;
    return old;
  end if;
  return null;
end;
$$;

create trigger discussion_posts_after_insert
  after insert on public.discussion_posts
  for each row execute function public.discussion_posts_after_write();
create trigger discussion_posts_after_delete
  after delete on public.discussion_posts
  for each row execute function public.discussion_posts_after_write();

-- ---------------------------------------------------------------------------
-- post_votes — ±1 per (post, user). Also the "mark helpful" mechanism used by
-- the peer-review UI (a helpful mark is simply value=1 cast on a comment).
-- ---------------------------------------------------------------------------
create table public.post_votes (
  id         uuid primary key default gen_random_uuid(),
  post_id    uuid not null references public.discussion_posts(id) on delete cascade,
  user_id    uuid not null references public.users_profile(id) on delete cascade,
  value      smallint not null check (value in (-1, 1)),
  created_at timestamptz not null default now(),
  unique (post_id, user_id)
);

create index post_votes_post_idx on public.post_votes (post_id);
create index post_votes_user_idx on public.post_votes (user_id, created_at desc);

create or replace function public.post_votes_after_write()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    update public.discussion_posts set vote_score = vote_score + new.value where id = new.post_id;
    return new;
  elsif tg_op = 'UPDATE' then
    update public.discussion_posts
      set vote_score = vote_score - old.value + new.value
      where id = new.post_id;
    return new;
  elsif tg_op = 'DELETE' then
    update public.discussion_posts set vote_score = vote_score - old.value where id = old.post_id;
    return old;
  end if;
  return null;
end;
$$;

create trigger post_votes_after_insert
  after insert on public.post_votes
  for each row execute function public.post_votes_after_write();
create trigger post_votes_after_update
  after update on public.post_votes
  for each row execute function public.post_votes_after_write();
create trigger post_votes_after_delete
  after delete on public.post_votes
  for each row execute function public.post_votes_after_write();

-- ---------------------------------------------------------------------------
-- shared_answers — an evaluated submission the owner opted to share for peer
-- review. One per submission (re-sharing is idempotent). Its own discussion
-- thread is auto-created with anchor_type='shared_answer', anchor_id=this row.
-- ---------------------------------------------------------------------------
create table public.shared_answers (
  id            uuid primary key default gen_random_uuid(),
  submission_id uuid not null unique references public.answer_submissions(id) on delete cascade,
  user_id       uuid not null references public.users_profile(id) on delete cascade,
  created_at    timestamptz not null default now()
);

create index shared_answers_user_idx on public.shared_answers (user_id, created_at desc);
create index shared_answers_recent_idx on public.shared_answers (created_at desc);

-- ---------------------------------------------------------------------------
-- reports — user reports on a thread or post. One report per (target, reporter);
-- repeat reports from the same user are a no-op upsert, not an error.
-- ---------------------------------------------------------------------------
create table public.reports (
  id           uuid primary key default gen_random_uuid(),
  target_type  report_target_type not null,
  target_id    uuid not null,
  reporter_id  uuid not null references public.users_profile(id) on delete cascade,
  reason       report_reason not null,
  detail       text,
  status       report_status not null default 'open',
  resolved_by  uuid references public.users_profile(id) on delete set null,
  resolved_at  timestamptz,
  created_at   timestamptz not null default now(),
  unique (target_type, target_id, reporter_id)
);

create index reports_open_idx on public.reports (created_at desc) where status = 'open';
create index reports_target_idx on public.reports (target_type, target_id);

-- ---------------------------------------------------------------------------
-- user_blocks — client AND server-side content filtering (services/community.ts
-- excludes a viewer's blocked authors from every thread/post list it returns).
-- ---------------------------------------------------------------------------
create table public.user_blocks (
  id         uuid primary key default gen_random_uuid(),
  blocker_id uuid not null references public.users_profile(id) on delete cascade,
  blocked_id uuid not null references public.users_profile(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

create index user_blocks_blocker_idx on public.user_blocks (blocker_id);

-- ---------------------------------------------------------------------------
-- post_screenings — append-only audit trail of every async moderation screen
-- (one row per thread creation and per post creation). Internal only: no RLS
-- policy at all (0056), same as llm_calls/generation_batches.
-- ---------------------------------------------------------------------------
create table public.post_screenings (
  id          uuid primary key default gen_random_uuid(),
  post_id     uuid references public.discussion_posts(id) on delete cascade,
  thread_id   uuid references public.discussion_threads(id) on delete cascade,
  is_abusive  boolean not null,
  is_spam     boolean not null,
  has_pii     boolean not null,
  reason      text not null,
  model       text not null,
  created_at  timestamptz not null default now(),
  check (post_id is not null or thread_id is not null)
);

create index post_screenings_post_idx on public.post_screenings (post_id);
create index post_screenings_thread_idx on public.post_screenings (thread_id);
