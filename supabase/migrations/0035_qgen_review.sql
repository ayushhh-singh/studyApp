-- 0035_qgen_review.sql
-- Question-generation engine + review surface.
--
-- Adds a review lifecycle to questions (draft/needs_review/approved/rejected)
-- and a per-question generation audit trail (generation_meta). A new
-- generation_batches table records each qgen run's acceptance rate + cost so
-- cost:report can compute cost-per-ACCEPTED-question.
--
-- Visibility change (enforced in code by lib/question-visibility.ts, not here):
-- user-facing contexts now require is_published AND review_state='approved'
-- (plus the existing CURRENT_AFFAIRS exception). To preserve today's behaviour,
-- every existing row is backfilled to 'approved' EXCEPT already-unpublished
-- generated content (the ca:run pipeline's review-gated MCQs), which becomes
-- 'needs_review' so the new Review Queue can finally surface it.
--
-- The `question_source` enum already covers pyq/generated/manual (migration
-- 0002), so no enum change is needed there.

-- ---------------------------------------------------------------------------
-- review_state enum + columns
-- ---------------------------------------------------------------------------
create type review_state as enum ('draft', 'needs_review', 'approved', 'rejected');

alter table public.questions
  add column review_state    review_state not null default 'approved',
  add column generation_meta jsonb;

comment on column public.questions.review_state is
  'Review lifecycle. User-facing visibility (lib/question-visibility.ts) requires approved. Defaults to approved so PYQ ingestion stays visible; qgen + ca:run set needs_review explicitly.';
comment on column public.questions.generation_meta is
  'For source=generated: {model, prompt_version, difficulty, critic_notes, verify_result, source_context_ids, batch_id, ...}. Null for PYQ/manual.';

-- Backfill: unpublished generated content (CA MCQs from ca/pipeline.ts) becomes
-- reviewable; everything else keeps today's effective state via the 'approved'
-- default. Idempotent-safe: only touches the narrow generated+unpublished set.
update public.questions
   set review_state = 'needs_review'
 where source = 'generated'
   and is_published = false;

-- Partial index for the Review Queue's hot path (needs_review, newest first).
create index questions_review_state_idx
  on public.questions (review_state, created_at desc)
  where review_state = 'needs_review';

-- ---------------------------------------------------------------------------
-- generation_batches — one row per qgen run (interactive or nightly)
-- ---------------------------------------------------------------------------
create table public.generation_batches (
  id               uuid primary key default gen_random_uuid(),
  kind             question_type not null,                 -- mcq | descriptive
  node_id          uuid references public.syllabus_nodes(id) on delete set null,
  requested_count  int not null default 0,
  -- Survivors after critic/blind-verify/dedup, inserted as needs_review.
  accepted_count   int not null default 0,
  -- Anthropic spend across all stages (generate + critic + verify) for the run.
  cost_usd         numeric not null default 0,
  -- run mode + per-stage rejection tallies + prompt version, for cost:report
  -- and the ops trail. { mode:'sync'|'batch', prompt_version, rejected:{...} }
  meta             jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now()
);

create index generation_batches_created_idx on public.generation_batches (created_at desc);
create index generation_batches_node_idx    on public.generation_batches (node_id);
