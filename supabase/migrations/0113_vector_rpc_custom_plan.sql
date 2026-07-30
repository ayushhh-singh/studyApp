-- 0113 — make the two vector-search RPCs usable from PostgREST again.
--
-- SYMPTOM (found while verifying the UPSC PYQ ingest): every
-- `match_embeddings` call through supabase-js/PostgREST failed with
-- `57014 canceling statement due to statement timeout` at ~8s, for EVERY
-- filter value and even at match_count=1 — while the identical query on a
-- direct psql connection ran in ~100ms. Because `retrieveGrounding` degrades
-- gracefully on an RPC error, the mentor silently answered UNGROUNDED on the
-- live exam rather than erroring, so nothing surfaced it.
--
-- ROOT CAUSE — a `language sql` function is INLINED into the caller's
-- statement. PostgREST executes RPCs as prepared statements, so after a few
-- executions Postgres switches that statement to a GENERIC plan, in which
-- `query_embedding` is an unknown parameter. A generic plan cannot use the
-- HNSW index for the ORDER BY, so it falls back to a sequential scan plus a
-- sort over ~28k rows x 1536 dims. Measured with a 60s function-level timeout,
-- that really does take 20.6s — the 8s `statement_timeout` on the
-- `authenticator` role was only the messenger.
--
-- Evidence trail, so nobody re-derives it:
--   * direct psql, same SQL, same service_role, same 8s timeout ...... ~100ms
--   * PostgREST, same function ................................. 8-11s, 57014
--   * PostgREST, same SQL via plpgsql EXECUTE (security invoker) ...... 60ms
--   * `ALTER FUNCTION ... SET plan_cache_mode='force_custom_plan'` DID NOT
--     help, which is itself the confirmation: a SET clause is attached to
--     function *execution*, and an inlined SQL function never executes as a
--     function at all.
--
-- FIX — plpgsql + dynamic EXECUTE. That is not stylistic: it makes the body
-- opaque to inlining, so each call is planned against the ACTUAL parameter
-- values and the HNSW index is used. Building the WHERE clause dynamically
-- also drops the `$n is null or ...` branches entirely for filters that are
-- not supplied, instead of leaving them as per-row filters in a generic plan.
--
-- SECOND FIX, in the same function — `hnsw.iterative_scan = strict_order`.
-- With a post-filter, plain HNSW returns only those of its `ef_search` (40)
-- candidates that survive the filter, so a SELECTIVE filter silently returns
-- FEWER rows than requested. Measured: filter_exam_code='upsc' asked for 8 and
-- got 5, i.e. the mentor was grounding on 5 passages while believing it had 8.
-- This bites the SMALLEST partition hardest, which is always the newest exam.
-- pgvector >= 0.8 (this DB is 0.8.2) keeps searching until the limit is met.
-- The two functions deliberately pick DIFFERENT modes, because what each one
-- does with the result differs:
--
--   * `match_embeddings` -> relaxed_order. Its callers take the whole top-k as
--     grounding context, so WHICH passages come back matters and their exact
--     internal ordering does not. Measured (both exams, typical AND an
--     adversarial probe — a UP-only topic filtered to the small `upsc`
--     partition, which forces the deepest search): relaxed 101-225ms across
--     the board; strict returned the same 8/8 rows but spiked to 4.1s on a
--     COLD adversarial call. Cold is exactly what a real user hits after idle,
--     so the predictability is worth more here than exact intra-k ordering.
--
--   * `match_doubt_faq` -> strict_order. Its TOP-1 similarity is compared
--     against hard thresholds (0.95 serve-silently / 0.86 serve-with-notice,
--     services/mentor/retrieval.ts), so a mis-ordered top hit can change a
--     cache decision. That table is ~40 rows, so strict costs nothing.
--
-- Measured after the change: 8/8 rows for every exam and filter, no timeouts.
--
-- It is applied with `set_config(..., is_local => true)` INSIDE the body rather
-- than as an `ALTER FUNCTION ... SET` clause: this database's migration role is
-- not superuser and `SET hnsw.iterative_scan` in a function's config list is
-- rejected with `42501 permission denied to set parameter`, while the runtime
-- `set_config` form is permitted for both `postgres` and `service_role`
-- (verified). `is_local => true` scopes it to the current transaction, so it
-- cannot leak onto a pooled connection and affect an unrelated later query.
--
-- Signatures, argument names, defaults, return columns and grants are
-- UNCHANGED — this is a behaviour-preserving reimplementation, so no API or
-- client change is needed. `stable` is retained (both are read-only).

-- ---------------------------------------------------------------------------
-- 1. match_embeddings
-- ---------------------------------------------------------------------------
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
language plpgsql
stable
as $$
declare
  sql text := 'select e.id, e.source_type, e.source_id, e.locale, e.chunk_text,
                      1 - (e.embedding OPERATOR(extensions.<=>) $1) as similarity
               from public.embeddings e
               where true';
begin
  perform set_config('hnsw.iterative_scan', 'relaxed_order', true);
  if filter_locale      is not null then sql := sql || ' and e.locale::text = $3'; end if;
  if filter_source_type is not null then sql := sql || ' and e.source_type::text = $4'; end if;
  if filter_source_id   is not null then sql := sql || ' and e.source_id = $5'; end if;
  -- A NULL exam_code is SHARED content and matches every exam (0107 §1); a NULL
  -- filter means no exam scoping at all. Semantics identical to the old body.
  if filter_exam_code   is not null then sql := sql || ' and (e.exam_code is null or e.exam_code = $6)'; end if;
  sql := sql || ' order by e.embedding OPERATOR(extensions.<=>) $1 limit greatest($2, 1)';

  return query execute sql
    using query_embedding, match_count, filter_locale, filter_source_type, filter_source_id, filter_exam_code;
end;
$$;

grant execute on function public.match_embeddings(extensions.vector, int, text, text, uuid, text)
  to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. match_doubt_faq — the same latent bug, fixed pre-emptively.
--
-- It is fast TODAY only because `doubt_faq_cache` holds ~40 rows, so even a
-- seq-scan plan is trivial. It is the identical shape (language sql + HNSW
-- ORDER BY + post-filters), so it acquires the identical 8s failure the moment
-- the cache grows — and its filter (locale AND exam) is MORE selective than
-- match_embeddings', so it is also more exposed to the under-return above.
-- Fixing it now costs nothing and removes a scheduled outage.
-- ---------------------------------------------------------------------------
create or replace function public.match_doubt_faq(
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
language plpgsql
stable
as $$
declare
  sql text := 'select c.id, c.question_text, c.answer, c.citations, c.mode,
                      1 - (c.embedding OPERATOR(extensions.<=>) $1) as similarity
               from public.doubt_faq_cache c
               where c.locale::text = $3';
begin
  perform set_config('hnsw.iterative_scan', 'strict_order', true);
  -- exam_code is NOT NULL on this table (0107 §3): a cached answer is always
  -- framed for exactly one exam, so there is no "shared" state to admit here.
  if filter_exam_code is not null then sql := sql || ' and c.exam_code = $4'; end if;
  sql := sql || ' order by c.embedding OPERATOR(extensions.<=>) $1 limit greatest($2, 1)';

  return query execute sql
    using query_embedding, match_count, filter_locale, filter_exam_code;
end;
$$;

grant execute on function public.match_doubt_faq(extensions.vector, text, int, text)
  to anon, authenticated, service_role;
