-- 0027_match_embeddings.sql
-- Cosine-similarity nearest-neighbour search over the pgvector `embeddings`
-- table, used by the AI answer-evaluation engine's RAG grounding step
-- (apps/api/src/services/evaluation/grounding.ts). PostgREST/Supabase can't
-- express a `<=>` ORDER BY through the query builder, so retrieval goes through
-- this RPC instead.
--
-- The `<=>` (cosine distance) operator and the vector type live in the
-- `extensions` schema (see 0001/0012), which is NOT on the default search_path,
-- so both are addressed with explicit OPERATOR(extensions.<=>) / type
-- qualification rather than relying on search_path resolution. similarity is
-- returned as 1 - cosine_distance (higher = closer), already ordered.
--
-- Table/function grants for the API roles are handled by the default-privileges
-- clause in 0015; this function is created after that migration, so it inherits
-- EXECUTE for anon/authenticated/service_role automatically. The explicit GRANT
-- below is belt-and-suspenders (idempotent) so RAG retrieval can never 42501.

create or replace function public.match_embeddings(
  query_embedding    extensions.vector(1536),
  match_count        int  default 8,
  filter_locale      text default null,
  filter_source_type text default null,
  filter_source_id   uuid default null
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
  order by e.embedding OPERATOR(extensions.<=>) query_embedding
  limit greatest(match_count, 1);
$$;

grant execute on function public.match_embeddings(
  extensions.vector, int, text, text, uuid
) to anon, authenticated, service_role;
