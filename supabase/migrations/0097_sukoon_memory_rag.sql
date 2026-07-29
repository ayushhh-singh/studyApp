-- =============================================================================
-- 0097_sukoon_memory_rag.sql — Saathi retrieval-augmented memory (upgrade of the
-- F2 rolling-summary mechanism into genuine semantic recall).
--
-- WHAT THIS IS: the SAME embeddings + cosine-ANN pattern the semantic-FAQ cache
-- already proves out (sukoon_semantic_cache + match_sukoon_semantic_cache, 0080),
-- applied to a new purpose — a per-user store of DISTILLED memory notes so Saathi
-- can surface a genuinely related past moment ("last time you mentioned the mock
-- test…") even weeks later, not just the most recent thread.
--
-- PRIVACY (SUKOON_CONTEXT / blueprint privacy-first): the substrate is DISTILLED
-- notes, never raw transcript chunks. Chat is already plaintext at rest, so a
-- gentle distillation of it is a reduction, not a new exposure. Journal bodies
-- stay ENCRYPTED at rest (0078/0081) — a journal memory item stores only a
-- minimal, non-verbatim emotional-theme note produced at write time (the one
-- moment the plaintext is in hand), NEVER the body and never the ciphertext. All
-- rows are owner-scoped, exported by services/export.ts, and erased by the F12
-- purge (services/purge.ts adds this table to USER_TABLES) + the auth.users
-- cascade — so it stays fully DPDP export-/delete-able like every other table.
--
-- Self-contained (only touches the new sukoon_ table), so it moves unchanged
-- into a standalone extraction, exactly like 0078/0079/0080. The read/write code
-- FAILS OPEN if this migration is absent (a missing table/RPC is just "no
-- memory"), so it's safe to ship ahead of applying this.
-- =============================================================================

create table if not exists public.sukoon_memory_items (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  -- Which surface the note was distilled from. source_id is the owning
  -- conversation (chat) or journal entry (journal) — "FK by convention" (the
  -- same idiom as srs_cards.source_id / discussion_threads.anchor_id): no hard
  -- FK, because a re-distill replaces by (source_kind, source_id) and a journal
  -- soft-delete clears its item explicitly (services/memory.ts). Nullable so an
  -- orphaned/manual note is still valid.
  source_kind text not null check (source_kind in ('chat', 'journal')),
  source_id   uuid,
  -- The distilled memory note (gentle, non-verbatim). For journal items this is
  -- a minimal emotional-theme note, never the entry body (which stays encrypted).
  note        text not null,
  -- Informational only (retrieval is cross-lingual — one user's whole memory is
  -- searched regardless of language). Set from the chat register where known,
  -- else null for a journal item.
  lang        text check (lang in ('hi', 'en', 'hinglish')),
  -- When the underlying moment happened (drives "about 3 weeks ago" phrasing and
  -- recency), distinct from created_at (when the note was distilled).
  occurred_at timestamptz not null default now(),
  embedding   extensions.vector(1536),
  created_at  timestamptz not null default now()
);

-- Cosine ANN over the embeddings (mirrors sukoon_semantic_cache's HNSW index).
create index if not exists sukoon_memory_items_embedding_idx
  on public.sukoon_memory_items
  using hnsw (embedding extensions.vector_cosine_ops);
-- Replace-by-source (a re-distill / journal edit deletes then re-inserts) and
-- the per-user recency scans.
create index if not exists sukoon_memory_items_source_idx
  on public.sukoon_memory_items (user_id, source_kind, source_id);
create index if not exists sukoon_memory_items_user_idx
  on public.sukoon_memory_items (user_id, occurred_at desc);

-- -----------------------------------------------------------------------------
-- Retrieval RPC — cosine ANN scoped to ONE user (PostgREST can't express a
-- `<=>` ORDER BY, same reason as match_sukoon_semantic_cache / match_embeddings).
--
-- SECURITY: the API queries with the service role (BYPASSRLS), so this
-- function's `where user_id = filter_user_id` is the ONE guard against
-- cross-user memory leakage — filter_user_id has NO default and the caller
-- always passes currentUserId(). exclude_source_id omits the CURRENT
-- conversation's own items (they're already in the live message window +
-- rolling summary, so re-surfacing them as "a past moment" would be wrong).
-- -----------------------------------------------------------------------------
create or replace function public.match_sukoon_memory(
  query_embedding   extensions.vector(1536),
  filter_user_id    uuid,
  match_count       int  default 3,
  exclude_source_id uuid default null
)
returns table (
  id          uuid,
  source_kind text,
  note        text,
  occurred_at timestamptz,
  similarity  double precision
)
language sql
stable
as $$
  select
    m.id,
    m.source_kind,
    m.note,
    m.occurred_at,
    1 - (m.embedding OPERATOR(extensions.<=>) query_embedding) as similarity
  from public.sukoon_memory_items m
  where m.user_id = filter_user_id
    and m.embedding is not null
    and (exclude_source_id is null or m.source_id is distinct from exclude_source_id)
  order by m.embedding OPERATOR(extensions.<=>) query_embedding
  limit greatest(match_count, 1);
$$;

-- -----------------------------------------------------------------------------
-- RLS — owner-scoped personal data (mirrors 0079's user_tables): full owner CRUD
-- for defense-in-depth + the standalone/direct-PostgREST path, service role for
-- the API. The retrieval RPC is service-role only (internal). Idempotent.
-- -----------------------------------------------------------------------------
alter table public.sukoon_memory_items enable row level security;
revoke all on public.sukoon_memory_items from anon, authenticated;
grant all on public.sukoon_memory_items to service_role;
grant select, insert, update, delete on public.sukoon_memory_items to authenticated;

drop policy if exists owner_select on public.sukoon_memory_items;
drop policy if exists owner_insert on public.sukoon_memory_items;
drop policy if exists owner_update on public.sukoon_memory_items;
drop policy if exists owner_delete on public.sukoon_memory_items;
create policy owner_select on public.sukoon_memory_items
  for select to authenticated using (auth.uid() = user_id);
create policy owner_insert on public.sukoon_memory_items
  for insert to authenticated with check (auth.uid() = user_id);
create policy owner_update on public.sukoon_memory_items
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy owner_delete on public.sukoon_memory_items
  for delete to authenticated using (auth.uid() = user_id);

-- Internal RPC: service-role only (the API calls it with the service role).
grant execute on function
  public.match_sukoon_memory(extensions.vector, uuid, int, uuid)
  to service_role;
