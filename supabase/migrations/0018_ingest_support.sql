-- 0018_ingest_support.sql
-- Columns + unique keys the content-ingestion pipeline (apps/api/src/ingest)
-- needs to load real UPPSC content idempotently and record provenance.
--
--  * syllabus_nodes.path — materialized tree path (slug/slug/...), unique per
--    paper. The idempotency key for ingest:syllabus is (paper_code, path).
--  * <table>.meta jsonb  — provenance: {machine_translated:true} for haiku-
--    filled languages, source manifest ids, answer-key verification, marking
--    scheme, etc.
--  * questions.external_id — idempotency key for ingest:pyq:load
--    (e.g. "pyq:uppsc_prelims_2024_gs1:q12").
--  * tests.slug — idempotency key for ingest:tests
--    (e.g. "pyq:PRE_GS1:2024", "sectional:PRE_GS1").
--  * embeddings.chunk_index + unique key — idempotent re-embedding.
--
-- All target tables are currently empty, so the NOT NULL DEFAULTs backfill
-- nothing. New columns inherit their table's grants; the anon/authenticated/
-- service_role default privileges from 0015 already cover them.

-- ---------------------------------------------------------------------------
-- syllabus_nodes: tree path + provenance
-- ---------------------------------------------------------------------------
alter table public.syllabus_nodes
  add column if not exists path text        not null default '',
  add column if not exists meta jsonb       not null default '{}'::jsonb;

-- One node per (paper_code, path). The paper root has path '' (unique because
-- paper_code is globally unique per paper).
create unique index if not exists syllabus_nodes_paper_path_key
  on public.syllabus_nodes(paper_code, path);

-- ---------------------------------------------------------------------------
-- questions: idempotency key + provenance
-- ---------------------------------------------------------------------------
alter table public.questions
  add column if not exists external_id text,
  add column if not exists meta        jsonb not null default '{}'::jsonb;

create unique index if not exists questions_external_id_key
  on public.questions(external_id) where external_id is not null;

-- ---------------------------------------------------------------------------
-- tests: idempotency slug + marking scheme / provenance in meta
-- ---------------------------------------------------------------------------
alter table public.tests
  add column if not exists slug text,
  add column if not exists meta jsonb not null default '{}'::jsonb;

create unique index if not exists tests_slug_key
  on public.tests(slug) where slug is not null;

-- ---------------------------------------------------------------------------
-- embeddings: stable chunk ordinal so re-embedding upserts in place
-- ---------------------------------------------------------------------------
alter table public.embeddings
  add column if not exists chunk_index int not null default 0;

create unique index if not exists embeddings_source_chunk_key
  on public.embeddings(source_type, source_id, locale, chunk_index);
