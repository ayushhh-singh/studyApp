-- 0070_mentor_cache_mode.sql
-- Session 26.5 — mentor cache & latency rework.
--
-- The doubt-FAQ semantic cache (0049) served every hit identically and stored no
-- answer "mode". This adds:
--   * doubt_faq_cache.mode      — 'normal' | 'revision', so a revision request
--     that lands on a cached NORMAL answer can be recognised and compressed
--     (one cheap haiku call) instead of regenerating from scratch, and so the
--     upsert dedup ("newest answer wins") never merges a normal answer over a
--     revision one.
--   * doubt_faq_cache.updated_at — bumped by the upsert so "newest wins" is
--     observable, and set_updated_at() keeps it current on any UPDATE.
-- and redefines match_doubt_faq to also RETURN the mode + id so the service can
-- do the two-tier serving (silent >= 0.95 / "similar doubt" 0.86–0.95) and the
-- mode-aware pick in one round trip.
--
-- Additive over 0049 (the table may be empty or full — the new column defaults
-- to 'normal', which is exactly the historical behaviour of every existing row).

alter table public.doubt_faq_cache
  add column if not exists mode       text        not null default 'normal',
  add column if not exists updated_at timestamptz not null default now();

-- Keep updated_at fresh on every UPDATE (the upsert path). set_updated_at()
-- exists from the original schema (0002) and is used by every other table.
drop trigger if exists trg_doubt_faq_cache_updated_at on public.doubt_faq_cache;
create trigger trg_doubt_faq_cache_updated_at
  before update on public.doubt_faq_cache
  for each row execute function public.set_updated_at();

-- The return signature changes (adds id already present + mode), so the function
-- must be dropped and recreated — create-or-replace can't change return columns.
drop function if exists public.match_doubt_faq(extensions.vector, text, int);

create function public.match_doubt_faq(
  query_embedding extensions.vector(1536),
  filter_locale   text,
  match_count     int default 1
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
  order by c.embedding OPERATOR(extensions.<=>) query_embedding
  limit greatest(match_count, 1);
$$;

grant execute on function public.match_doubt_faq(extensions.vector, text, int)
  to anon, authenticated, service_role;
