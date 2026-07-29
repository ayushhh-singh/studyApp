-- =============================================================================
-- 0080_sukoon_semantic_cache_match.sql — the Saathi semantic-FAQ READ path
-- (blueprint F2 cost spine). PostgREST can't express a `<=>` ORDER BY, so cosine
-- ANN over sukoon_semantic_cache goes through this RPC — mirrors match_doubt_faq
-- (0070). Self-contained (only touches the sukoon_ table), so it moves unchanged
-- into a standalone extraction, same as 0078/0079.
--
-- The chat read path (services/semantic-cache.ts) FAILS OPEN if this function is
-- absent, so it's safe to ship the code ahead of applying this migration — a
-- missing RPC is just a cache miss. Apply via `supabase db push` the usual way.
-- =============================================================================

create or replace function public.match_sukoon_semantic_cache(
  query_embedding extensions.vector(1536),
  filter_lang     text,
  match_count     int default 1
)
returns table (
  id         uuid,
  response   text,
  lang       text,
  reviewed   boolean,
  similarity double precision
)
language sql
stable
as $$
  select
    c.id,
    c.response,
    c.lang,
    c.reviewed,
    1 - (c.embedding OPERATOR(extensions.<=>) query_embedding) as similarity
  from public.sukoon_semantic_cache c
  where c.lang = filter_lang
    and c.reviewed = true
    and c.embedding is not null
  order by c.embedding OPERATOR(extensions.<=>) query_embedding
  limit greatest(match_count, 1);
$$;

-- Internal, service-role-only (the API calls it with the service role); the
-- table itself is RLS-on/no-policy per 0079, so no anon/authenticated grant.
grant execute on function public.match_sukoon_semantic_cache(extensions.vector, text, int)
  to service_role;
