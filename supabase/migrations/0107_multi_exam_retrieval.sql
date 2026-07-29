-- 0107_multi_exam_retrieval.sql
-- Closes the two BLOCKING follow-ups 0106 wrote into its own §9 and §10 headers
-- (docs/OUTSTANDING.md §8a M3 + M4): the exam columns on `embeddings` and
-- `doubt_faq_cache` existed but were INERT — nothing read them, so a second
-- exam's content would have been retrieved for, and cited to, the wrong exam's
-- users.
--
-- Both fixes are a filter INSIDE the RPC, never a post-filter in TypeScript:
-- `ORDER BY vector <=> query LIMIT k` runs against the HNSW index, so filtering
-- the returned top-k destroys recall (the entire top-k can be another exam's
-- near-identical chapter, leaving zero rows after the filter). A cheap predicate
-- on the same table is the only shape that both filters and keeps the index.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHY `filter_exam_code` DEFAULTS TO NULL RATHER THAN BEING REQUIRED
-- ─────────────────────────────────────────────────────────────────────────────
-- A required parameter would make the enforcement structural, but it also makes
-- the migration and the API deploy a coupled pair: this migration lands first,
-- and until the new API rolls out, every old-code RPC call would fail. Mentor
-- retrieval and evaluation grounding both degrade gracefully on an RPC error
-- (they answer ungrounded), so the failure would be silent quality loss rather
-- than an error page — the worst kind.
--
-- So the SQL stays backward-compatible and the enforcement lives in TypeScript
-- instead: `examCode` is a REQUIRED (non-optional) parameter on every wrapper in
-- apps/api — services/evaluation/grounding.ts `retrieveGrounding`,
-- services/mentor/retrieval.ts `retrieveContext` / `lookupFaqCandidates` /
-- `upsertFaqCache` — so the compiler, not convention, forces each of the ~12
-- call sites to decide which exam it is retrieving for.

-- ---------------------------------------------------------------------------
-- 1. embeddings.exam_code — NULL now means "shared across every exam"
-- ---------------------------------------------------------------------------
-- 0106 added this NOT NULL DEFAULT 'uppsc'. That cannot express the one content
-- type which is genuinely multi-exam: a current-affairs item. 0106 §11 verified
-- and deliberately kept `current_affairs_items.syllabus_node_ids` as a bare
-- uuid[] precisely so one national story (budget / IR / environment) can map
-- into SEVERAL exams' trees without being duplicated and re-paying its triage +
-- enrich LLM cost per copy. Its embedding row cannot follow suit: the unique key
-- is (source_type, source_id, locale, chunk_index), so there is exactly one row
-- per item per locale and no room for a per-exam copy.
--
-- Forcing a scalar there would mean picking one exam and hiding a genuinely
-- national item from every other exam's mentor. NULL = "belongs to no single
-- exam, retrievable by all" is the honest third state.
--
-- Scalar-exam content (syllabus nodes, questions, notes) still stamps its real
-- exam and is NOT affected — see apps/api/src/lib/embed-upsert.ts.
alter table public.embeddings
  alter column exam_code drop not null;

comment on column public.embeddings.exam_code is
  'Denormalized exam of the source row; NULL means shared across every exam (a current-affairs item mapped into several exams'' trees — see 0106 §11). Denormalized deliberately: a vector ANN search cannot be post-filtered or join-filtered without wrecking recall or the HNSW index. Read by match_embeddings (0107).';

-- ---------------------------------------------------------------------------
-- 2. match_embeddings — the exam filter, inside the RPC
-- ---------------------------------------------------------------------------
-- Adding a parameter changes the argument list, which would create a second
-- OVERLOAD rather than replace the 0027 function — PostgREST would then have two
-- candidates for a named-argument call. Drop the old signature explicitly.
drop function if exists public.match_embeddings(extensions.vector, int, text, text, uuid);

create or replace function public.match_embeddings(
  query_embedding    extensions.vector(1536),
  match_count        int  default 8,
  filter_locale      text default null,
  filter_source_type text default null,
  filter_source_id   uuid default null,
  filter_exam_code   text default null
)
returns table (
  id          uuid,
  source_type embedding_source_type,
  source_id   uuid,
  locale      locale,
  chunk_text  text,
  similarity  double precision
)
language sql
stable
as $$
  select
    e.id,
    e.source_type,
    e.source_id,
    e.locale,
    e.chunk_text,
    1 - (e.embedding OPERATOR(extensions.<=>) query_embedding) as similarity
  from public.embeddings e
  where (filter_locale      is null or e.locale::text      = filter_locale)
    and (filter_source_type is null or e.source_type::text = filter_source_type)
    and (filter_source_id   is null or e.source_id         = filter_source_id)
    -- NULL exam_code is SHARED content and matches every exam (see §1). A NULL
    -- filter is "no exam scoping at all" — kept only for backward compatibility
    -- with a pre-deploy caller; every apps/api caller passes a real exam.
    and (filter_exam_code   is null or e.exam_code is null or e.exam_code = filter_exam_code)
  order by e.embedding OPERATOR(extensions.<=>) query_embedding
  limit greatest(match_count, 1);
$$;

grant execute on function public.match_embeddings(
  extensions.vector, int, text, text, uuid, text
) to anon, authenticated, service_role;

-- NOTE (added after the fact, see 0108): this index is REDUNDANT — 0106 §9
-- already created `embeddings_exam_locale_idx` on exactly these columns. It is
-- left here so the applied migration and its file continue to agree, and dropped
-- by 0108. Do not copy this pattern; check for an existing index first.
create index if not exists embeddings_exam_locale_source_idx
  on public.embeddings(exam_code, locale, source_type);

-- ---------------------------------------------------------------------------
-- 3. match_doubt_faq — the same filter, on the semantic ANSWER cache
-- ---------------------------------------------------------------------------
-- This one is the more dangerous of the two. `doubt_faq_cache` is a GLOBAL
-- answer cache keyed only by (embedding, locale, mode): an MPPSC user asking
-- "explain the amendment procedure" would hit a cached, UPPSC-framed answer —
-- complete with UPPSC PYQ references — at >= 0.95 similarity and be served it
-- SILENTLY, with no model call and nothing in the UI to indicate it.
--
-- The same function also backs the WRITE path's near-duplicate lookup
-- (`upsertFaqCache`), so filtering here scopes the cache in both directions at
-- once: one exam's regenerated answer can never overwrite another exam's row.
--
-- exam_code stays NOT NULL here — unlike an embedding, a cached answer is always
-- framed for exactly one exam; there is no "shared" state to represent.
drop function if exists public.match_doubt_faq(extensions.vector, text, int);

create function public.match_doubt_faq(
  query_embedding  extensions.vector(1536),
  filter_locale    text,
  match_count      int  default 1,
  filter_exam_code text default null
)
returns table (
  id            uuid,
  question_text text,
  answer        text,
  citations     jsonb,
  mode          text,
  similarity    double precision
)
language sql
stable
as $$
  select
    c.id,
    c.question_text,
    c.answer,
    c.citations,
    c.mode,
    1 - (c.embedding OPERATOR(extensions.<=>) query_embedding) as similarity
  from public.doubt_faq_cache c
  where c.locale::text = filter_locale
    and (filter_exam_code is null or c.exam_code = filter_exam_code)
  order by c.embedding OPERATOR(extensions.<=>) query_embedding
  limit greatest(match_count, 1);
$$;

grant execute on function public.match_doubt_faq(extensions.vector, text, int, text)
  to anon, authenticated, service_role;

create index if not exists doubt_faq_cache_exam_locale_idx
  on public.doubt_faq_cache(exam_code, locale, mode);
