-- 0031_current_affairs_pipeline.sql
-- Support columns for the automated current-affairs ingestion pipeline
-- (apps/api/src/ca/). detail_i18n is restructured (application-side only —
-- it stays jsonb) into {what_happened, why_it_matters, key_facts, question_angle}
-- instead of a flat bilingual blob; no column change needed for that.

-- Dedupe key so re-running the pipeline (cron or manual `pnpm ca:run`) never
-- inserts the same article twice: sha256 of the item's canonical source URL.
-- Nullable + partial-unique so nothing blocks rows inserted before this
-- migration (there are none yet in practice, but the pattern matches
-- questions/tests' own nullable-until-backfilled columns elsewhere).
alter table public.current_affairs_items
  add column content_hash text;

create unique index current_affairs_content_hash_key
  on public.current_affairs_items(content_hash)
  where content_hash is not null;

-- Which configured source (apps/api/src/ca/sources.ts id) produced the item —
-- lets the pipeline report per-source yield and lets a future admin view
-- filter/debug by source.
alter table public.current_affairs_items
  add column source_id text;
