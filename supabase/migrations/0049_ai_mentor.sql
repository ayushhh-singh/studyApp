-- 0049_ai_mentor.sql
-- The AI Mentor: a RAG doubt-solving chatbot grounded in OUR content AND the
-- learner's own data, plus proactive (never-initiating) nudge cards.
--
-- The chat tables `doubt_threads` / `doubt_messages` (and the `doubt_role` enum)
-- already exist from the original schema (0011/0002). This migration REUSES them
-- and only adds the two columns the mentor needs on `doubt_messages`, then adds
-- three new tables + one ANN RPC:
--   learner_profiles  — one compact, size-capped JSON snapshot per user
--                       (weak/strong nodes, eval trend, streak, pace…), refreshed
--                       nightly and on-demand; injected into every mentor answer.
--   doubt_faq_cache   — the semantic answer cache (cost lever): a NEW question
--                       that embeds above a high similarity threshold to a
--                       previously answered, NON-personal doubt is served from
--                       here with no model call. Only non-personal answers land
--                       here (personal ones always go to the model).
--   mentor_insights   — proactive cards derived from the learner profile, shown
--                       one-at-a-time on the dashboard; idempotent per dedupe_key.
--
-- `extensions.vector` / the `<=>` cosine operator live in the extensions schema
-- (see 0001/0012), addressed explicitly here, exactly like 0027. New tables get
-- the same dev-permissive RLS as 0013 ("REPLACED IN AUTH PHASE"); table/function
-- grants for anon/authenticated/service_role come from 0015's default privileges.

-- ---------------------------------------------------------------------------
-- Reuse the existing chat tables — just add the mentor's per-answer flags.
--   used_profile: true when the answer was allowed to draw on the learner
--     profile (personal questions); such answers are never written to the FAQ
--     cache. Tracked at answer time (Feature 3).
--   meta: structured extras, e.g. { kind: 'quiz', questions: [...] } for the
--     in-thread "quiz me on this" action (Feature 4).
-- (citations jsonb already exists on doubt_messages from 0011.)
-- ---------------------------------------------------------------------------
alter table public.doubt_messages
  add column if not exists used_profile boolean not null default false,
  add column if not exists meta         jsonb   not null default '{}'::jsonb;

-- ---------------------------------------------------------------------------
-- Learner profile (Feature 1)
-- ---------------------------------------------------------------------------
create table public.learner_profiles (
  user_id     uuid primary key references public.users_profile(id) on delete cascade,
  profile     jsonb       not null default '{}'::jsonb,
  computed_at timestamptz not null default now(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger trg_learner_profiles_updated_at
  before update on public.learner_profiles
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Doubt-FAQ semantic cache (Feature 3)
-- ---------------------------------------------------------------------------
create table public.doubt_faq_cache (
  id            uuid primary key default gen_random_uuid(),
  question_text text not null,
  embedding     extensions.vector(1536) not null,
  locale        locale not null,
  answer        text not null,
  citations     jsonb not null default '[]'::jsonb,
  -- How many times this cached answer has been served (observability).
  hit_count     int not null default 0,
  created_at    timestamptz not null default now()
);

-- HNSW cosine index, same opclass as the main embeddings store (0012). The FAQ
-- cache is small, but this keeps ANN lookups O(log n) as it grows.
create index doubt_faq_cache_embedding_idx
  on public.doubt_faq_cache
  using hnsw (embedding extensions.vector_cosine_ops);

-- Nearest cached doubt by cosine similarity, in a given locale. Same explicit
-- extensions-schema qualification as match_embeddings (0027).
create or replace function public.match_doubt_faq(
  query_embedding extensions.vector(1536),
  filter_locale   text,
  match_count     int default 1
)
returns table (
  id            uuid,
  question_text text,
  answer        text,
  citations     jsonb,
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
    1 - (c.embedding OPERATOR(extensions.<=>) query_embedding) as similarity
  from public.doubt_faq_cache c
  where c.locale::text = filter_locale
  order by c.embedding OPERATOR(extensions.<=>) query_embedding
  limit greatest(match_count, 1);
$$;

grant execute on function public.match_doubt_faq(extensions.vector, text, int)
  to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Proactive mentor insights (Feature 5)
-- ---------------------------------------------------------------------------
create table public.mentor_insights (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.users_profile(id) on delete cascade,
  kind         text not null,
  insight_i18n jsonb not null,
  -- In-app deep link (locale prefixed client-side), e.g. "/practice?node=…".
  cta_link     text,
  dismissed    boolean not null default false,
  -- One insight per (user, dedupe_key), e.g. 'weak_node:<id>:2026-07-08'.
  dedupe_key   text not null,
  meta         jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (user_id, dedupe_key)
);

create index mentor_insights_active_idx
  on public.mentor_insights(user_id, created_at desc)
  where dismissed = false;

create trigger trg_mentor_insights_updated_at
  before update on public.mentor_insights
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Dev-permissive RLS on the NEW tables (REPLACED IN AUTH PHASE — like 0013).
-- doubt_threads/doubt_messages already have their dev RLS from earlier phases.
-- ---------------------------------------------------------------------------
alter table public.learner_profiles enable row level security;
create policy dev_permissive_all on public.learner_profiles
  for all to anon, authenticated using (true) with check (true);

alter table public.doubt_faq_cache enable row level security;
create policy dev_permissive_all on public.doubt_faq_cache
  for all to anon, authenticated using (true) with check (true);

alter table public.mentor_insights enable row level security;
create policy dev_permissive_all on public.mentor_insights
  for all to anon, authenticated using (true) with check (true);
