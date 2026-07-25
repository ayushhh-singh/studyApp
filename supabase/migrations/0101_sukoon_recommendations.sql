-- =============================================================================
-- 0101_sukoon_recommendations.sql — semantic "For you" recommendations over the
-- STATIC content library (F6 exercises + F7 journeys).
--
-- WHAT THIS IS: the SAME embeddings + cosine-ANN spine the semantic-FAQ cache
-- (sukoon_semantic_cache + match_sukoon_semantic_cache, 0080) and Saathi memory
-- (sukoon_memory_items + match_sukoon_memory, 0097) already prove out — applied
-- to a new purpose: one embedding per exercise/journey (its title + a curated
-- bilingual "what it helps with" descriptor + theme tags), so the app can rank
-- calming tools by GENUINE semantic similarity to a person's recent emotional
-- signal, instead of the static ordered list exercises.ts/journeys.ts return today.
--
-- STATIC, NOT USER DATA: sukoon_content_embeddings holds embeddings of
-- operator-seeded content (blueprint: "nothing generates content at runtime that
-- can be pre-generated"). It is computed ONCE per content item (or on content
-- edit) by `pnpm sukoon:embed-content`, never per request — the only per-request
-- cost is embedding the user's own rolling signal. So this table gets the same
-- "internal, service-role only, no owner policy" posture as sukoon_semantic_cache
-- (0079/0080) — there is no user_id here and nothing to scope per user.
--
-- The read path (services/recommendations.ts) FAILS OPEN if this migration is
-- absent (a missing table/RPC → an empty match → a gentle getting-started
-- fallback set), so the feature code is safe to ship ahead of applying this.
--
-- Self-contained (only new sukoon_ objects), so it moves unchanged into a
-- standalone extraction, exactly like 0078/0079/0080/0097. A direct
-- `db push --db-url` connection gets no automatic Supabase API-role grants, so
-- grants are spelled out explicitly (the 42501 gotcha, see
-- [[supabase-headless-migrations]]). Idempotent: `if not exists` everywhere.
-- =============================================================================

create table if not exists public.sukoon_content_embeddings (
  id           uuid primary key default gen_random_uuid(),
  -- Which library the row indexes.
  content_kind text not null check (content_kind in ('exercise', 'journey')),
  -- The catalog row this embedding stands for. "FK by convention" (same idiom as
  -- srs_cards.source_id / sukoon_memory_items.source_id): no hard FK, because the
  -- embed job re-derives rows by the stable content_ref below and content can be
  -- re-seeded (delete+reinsert) with fresh uuids. content_id is the current uuid
  -- for a direct join at read time.
  content_id   uuid not null,
  -- The STABLE cross-reference: an exercise's seed `key` (0084) or a journey's
  -- `slug`. This is the idempotent-upsert key, so a re-seed that changes content_id
  -- still updates the same embedding row rather than orphaning it.
  content_ref  text not null,
  -- Theme tags this content addresses, drawn from the SAME fixed vocabularies the
  -- rest of Sukoon uses (F5 emotions + mood factors) plus a small free "topics"
  -- set (sleep/exam/focus/…). These drive the honest, specific reasoning line
  -- ("because sleep has come up in your check-ins") by intersecting with the
  -- user's recent signal — returned by the RPC so the service needs no 2nd query.
  emotions     text[] not null default '{}',
  factors      text[] not null default '{}',
  topics       text[] not null default '{}',
  -- sha256 of the exact embed input (descriptor text + theme tags). The embed job
  -- skips re-embedding a row whose hash is unchanged, so a re-run is cheap and
  -- only spends on genuinely edited/added content.
  source_hash  text not null,
  embedding    extensions.vector(1536),
  updated_at   timestamptz not null default now()
);

-- One embedding per content item (the idempotent-upsert target).
create unique index if not exists sukoon_content_embeddings_ref_uidx
  on public.sukoon_content_embeddings (content_kind, content_ref);
-- Cosine ANN over the embeddings (mirrors sukoon_memory_items / sukoon_semantic_cache).
create index if not exists sukoon_content_embeddings_embedding_idx
  on public.sukoon_content_embeddings
  using hnsw (embedding extensions.vector_cosine_ops);

-- -----------------------------------------------------------------------------
-- Retrieval RPC — cosine ANN over the content library (PostgREST can't express a
-- `<=>` ORDER BY, same reason as match_sukoon_memory / match_sukoon_semantic_cache).
--
-- No per-user filter: this is static content shared by everyone (unlike the
-- memory RPC, whose user scoping is a security boundary). `filter_kinds` lets a
-- caller restrict to exercises or journeys; null = both. Returns the theme tags
-- so the service can pick the reasoning line without a second lookup.
-- -----------------------------------------------------------------------------
create or replace function public.match_sukoon_content(
  query_embedding extensions.vector(1536),
  filter_kinds    text[] default null,
  match_count     int    default 12
)
returns table (
  content_kind text,
  content_id   uuid,
  content_ref  text,
  emotions     text[],
  factors      text[],
  topics       text[],
  similarity   double precision
)
language sql
stable
as $$
  select
    c.content_kind,
    c.content_id,
    c.content_ref,
    c.emotions,
    c.factors,
    c.topics,
    1 - (c.embedding OPERATOR(extensions.<=>) query_embedding) as similarity
  from public.sukoon_content_embeddings c
  where c.embedding is not null
    and (filter_kinds is null or c.content_kind = any(filter_kinds))
  order by c.embedding OPERATOR(extensions.<=>) query_embedding
  limit greatest(match_count, 1);
$$;

-- -----------------------------------------------------------------------------
-- Grants / RLS — internal content table (mirrors sukoon_semantic_cache, 0079):
-- RLS on with NO policy, so anon/authenticated are fully denied and only the
-- service role (the API + the embed job) can read/write. The RPC is
-- service-role only. Explicit grants for the direct db-push connection.
-- -----------------------------------------------------------------------------
alter table public.sukoon_content_embeddings enable row level security;
revoke all on public.sukoon_content_embeddings from anon, authenticated;
grant all on public.sukoon_content_embeddings to service_role;

grant execute on function
  public.match_sukoon_content(extensions.vector, text[], int)
  to service_role;
