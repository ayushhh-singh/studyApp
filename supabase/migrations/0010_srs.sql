-- 0010_srs.sql
-- FSRS spaced-repetition cards + review log. The full FSRS scheduler state
-- (stability, difficulty, due_at, reps, lapses, state) lives in fsrs_state jsonb.

create table public.srs_cards (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.users_profile(id) on delete cascade,
  front_i18n  jsonb not null,
  back_i18n   jsonb not null,
  source_type srs_source_type not null,
  source_id   uuid,                       -- FK-by-convention to the source row (question/current_affairs)
  -- { stability, difficulty, due_at (timestamptz), reps, lapses, state }
  fsrs_state  jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Due-card lookups: user + due_at extracted from the FSRS state.
create index srs_cards_user_idx on public.srs_cards(user_id);
create index srs_cards_due_idx  on public.srs_cards(user_id, ((fsrs_state ->> 'due_at')));

create trigger trg_srs_cards_updated_at
  before update on public.srs_cards
  for each row execute function public.set_updated_at();

create table public.srs_reviews (
  id             uuid primary key default gen_random_uuid(),
  card_id        uuid not null references public.srs_cards(id)     on delete cascade,
  user_id        uuid not null references public.users_profile(id) on delete cascade,
  rating         int  not null check (rating between 1 and 4),   -- again/hard/good/easy
  reviewed_at    timestamptz not null default now(),
  elapsed_days   numeric,
  scheduled_days numeric,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index srs_reviews_card_idx on public.srs_reviews(card_id, reviewed_at desc);
create index srs_reviews_user_idx on public.srs_reviews(user_id, reviewed_at desc);

create trigger trg_srs_reviews_updated_at
  before update on public.srs_reviews
  for each row execute function public.set_updated_at();
