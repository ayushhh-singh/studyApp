-- 0012_embeddings_events.sql
-- pgvector store for RAG (OpenAI text-embedding-3-small, 1536-dim) + a
-- lightweight analytics events table.

create table public.embeddings (
  id          uuid primary key default gen_random_uuid(),
  source_type embedding_source_type not null,
  source_id   uuid not null,                 -- FK-by-convention to the source row
  locale      locale not null,
  chunk_text  text not null,
  embedding   extensions.vector(1536) not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index embeddings_source_idx on public.embeddings(source_type, source_id);

-- Approximate nearest-neighbour search over cosine distance.
create index embeddings_hnsw_idx on public.embeddings
  using hnsw (embedding extensions.vector_cosine_ops);

create trigger trg_embeddings_updated_at
  before update on public.embeddings
  for each row execute function public.set_updated_at();

create table public.events (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references public.users_profile(id) on delete cascade,
  name       text not null,
  props      jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index events_user_idx on public.events(user_id, created_at desc);
create index events_name_idx on public.events(name, created_at desc);

create trigger trg_events_updated_at
  before update on public.events
  for each row execute function public.set_updated_at();
