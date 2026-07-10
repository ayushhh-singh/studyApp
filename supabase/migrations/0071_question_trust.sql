-- 0070_question_trust.sql
-- QUESTION-BANK TRUST layer. Real users are now hitting wrong answers and wrong
-- explanations (e.g. a generated MCQ that both the generator AND the single-model
-- critic pass got wrong, because single-model verification shares the generator's
-- wrong beliefs). This migration adds the persistence for three defences:
--
--   1. question_reports  — user "Report this question" complaints (highest-signal
--      QA now that real users exist). Two INDEPENDENT reports on one question →
--      auto needs_review + unpublished (done in the service layer, not a trigger,
--      so it is observable/testable — see services/question-reports.ts).
--   2. question_audits   — the stored results of the automated consistency sweep
--      (explanation-vs-key + hi/en permutation) and the blind re-solve audit
--      (RAG-grounded independent solve). One row per (question, audit_kind), so a
--      re-run upserts and the CLIs are resumable. Internal-only, service role only.
--   3. question_quality  — a metrics VIEW rolling report / inconsistency /
--      re-solve-disagreement rates up by source_kind and generation prompt_version,
--      surfaced by `pnpm cost:report` with the alert thresholds in docs/operations.md.
--
-- Provenance columns the Reports queue renders (source_kind, generation_meta,
-- meta, exam_code, year) already exist (migrations 0005/0018/0035/0036) — no new
-- question columns are needed. Hiding a flagged question reuses the existing
-- mechanism: review_state='needs_review' + is_published=false (0053's catalog
-- visibility predicate requires is_published AND review_state='approved').
--
-- RLS follows 0053/0056 exactly: the Express API writes with the service-role key
-- (bypasses RLS) after scoping by currentUserId(), so RLS here is defense-in-depth
-- for the browser's direct anon-key surface, not the app's real authorization.

-- ---------------------------------------------------------------------------
-- question_reports — user complaints about a specific question.
-- ---------------------------------------------------------------------------
create type question_report_reason as enum (
  'wrong_answer', 'wrong_explanation', 'translation', 'ambiguous', 'other'
);
create type question_report_status as enum ('open', 'resolved', 'dismissed');
create type question_report_resolution as enum (
  'fixed_key', 'regenerated_explanation', 'unpublished', 'edited', 'dismissed'
);

create table public.question_reports (
  id           uuid primary key default gen_random_uuid(),
  question_id  uuid not null references public.questions(id) on delete cascade,
  -- Nullable so a report survives the reporter deleting their account (we still
  -- want the signal). currentUserId() always sets it on the insert path.
  user_id      uuid references public.users_profile(id) on delete set null,
  reason       question_report_reason not null,
  detail       text,
  status       question_report_status not null default 'open',
  resolution   question_report_resolution,
  resolved_by  uuid references public.users_profile(id) on delete set null,
  resolved_at  timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table public.question_reports is
  'User "Report this question" complaints. Two independent open reports on one question auto-flip it to needs_review + unpublished (services/question-reports.ts).';

-- One OPEN report per user per question — makes "distinct reporters" == "open
-- report count" for the auto-hide threshold, and lets a re-report upsert the
-- reason/detail instead of piling up duplicates.
create unique index question_reports_one_open_per_user
  on public.question_reports (question_id, user_id)
  where status = 'open';
create index question_reports_question_idx on public.question_reports (question_id);
create index question_reports_open_idx on public.question_reports (status, created_at desc)
  where status = 'open';

create trigger question_reports_set_updated_at
  before update on public.question_reports
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- question_audits — automated audit results (consistency sweep + re-solve).
-- Internal-only (like llm_calls / post_screenings): RLS on, no policy → only
-- the service role reads/writes it.
-- ---------------------------------------------------------------------------
create table public.question_audits (
  id           uuid primary key default gen_random_uuid(),
  question_id  uuid not null references public.questions(id) on delete cascade,
  audit_kind   text not null check (audit_kind in ('consistency', 'resolve')),
  run_id       text not null,
  status       text not null check (status in ('ok', 'flagged', 'error', 'skipped')),
  model        text,
  -- The full evidence for the verdict: for consistency, {argued_key, stored_key,
  -- explanation_ok, permutation_ok}; for resolve, {solver_key, stored_key,
  -- ground_truth, escalated, decisive_facts, web_sources, reasoning}.
  detail       jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);

comment on table public.question_audits is
  'Stored results of the consistency sweep + blind re-solve audit. One row per (question, audit_kind) — a re-run upserts, so the audit CLIs are resumable.';

-- One latest audit per kind per question (upsert target; also makes re-runs
-- resumable — the CLI skips question ids already audited under the same run_id).
create unique index question_audits_one_per_kind
  on public.question_audits (question_id, audit_kind);
create index question_audits_kind_status_idx on public.question_audits (audit_kind, status);
create index question_audits_run_idx on public.question_audits (audit_kind, run_id);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.question_reports enable row level security;
alter table public.question_audits  enable row level security;

-- question_reports — write-only for regular users (insert their own report); no
-- select policy, so only the service role (the admin Reports queue) reads them.
-- Mirrors community `reports` (0056). The browser never inserts directly (the
-- Express API does, via service role) — this is defense-in-depth.
create policy owner_insert on public.question_reports
  for insert to authenticated with check (auth.uid() = user_id);

-- question_audits — internal only. RLS on, no policy at all → anon and
-- authenticated fully denied; only the service role reaches it (llm_calls shape).

-- ---------------------------------------------------------------------------
-- question_quality — the metrics view. Aggregates published-MCQ health by
-- source_kind and generation prompt_version. Read by `pnpm cost:report` (service
-- role, which bypasses RLS). Owned by the migration role (no security_invoker),
-- so it reads the underlying tables unfiltered — same pattern as community_authors.
-- ---------------------------------------------------------------------------
create or replace view public.question_quality as
with pub as (
  select
    q.id,
    q.source_kind,
    coalesce(q.generation_meta ->> 'prompt_version', '-') as prompt_version
  from public.questions q
  where q.is_published = true and q.type = 'mcq'
),
rep as (
  select question_id, count(*) filter (where status = 'open') as open_reports
  from public.question_reports
  group by question_id
),
cons as (
  select question_id, status from public.question_audits where audit_kind = 'consistency'
),
res as (
  select question_id, status from public.question_audits where audit_kind = 'resolve'
)
select
  p.source_kind,
  p.prompt_version,
  count(*)                                                        as published_mcq,
  count(*) filter (where coalesce(r.open_reports, 0) > 0)         as reported_questions,
  coalesce(sum(r.open_reports), 0)                               as open_reports,
  round(
    (count(*) filter (where coalesce(r.open_reports, 0) > 0))::numeric
      / nullif(count(*), 0), 4)                                   as report_rate,
  count(*) filter (where cons.status is not null)                as consistency_checked,
  count(*) filter (where cons.status = 'flagged')                as consistency_flagged,
  round(
    (count(*) filter (where cons.status = 'flagged'))::numeric
      / nullif(count(*) filter (where cons.status is not null), 0), 4) as inconsistency_rate,
  count(*) filter (where res.status is not null)                 as resolve_checked,
  count(*) filter (where res.status = 'flagged')                 as resolve_flagged,
  round(
    (count(*) filter (where res.status = 'flagged'))::numeric
      / nullif(count(*) filter (where res.status is not null), 0), 4) as resolve_disagreement_rate
from pub p
left join rep  r    on r.question_id    = p.id
left join cons      on cons.question_id = p.id
left join res       on res.question_id  = p.id
group by p.source_kind, p.prompt_version
order by p.source_kind, p.prompt_version;

comment on view public.question_quality is
  'Published-MCQ health by source_kind + generation prompt_version: report rate, inconsistency rate (consistency sweep), re-solve disagreement rate. Surfaced by pnpm cost:report.';

-- Internal QA metrics — not for the browser. 0015's default privileges grant
-- select on new relations (incl. views) to anon/authenticated; revoke that here
-- so only the service role (cost:report) can read it.
revoke all on public.question_quality from anon, authenticated;
grant select on public.question_quality to service_role;
