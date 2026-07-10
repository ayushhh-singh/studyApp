-- ---------------------------------------------------------------------------
-- 0066 — user_notes: personal study material saved from an AI-Mentor answer.
--
-- "Save as study material" on any mentor answer runs a structured conversion
-- of the answer into the SAME fixed block structure as an official `notes`
-- row (content_i18n: {hi,en} NoteBody), but owned by ONE user and private to
-- them. No review queue, no publish gate, never shown to other users — so RLS
-- is strict owner-only (the defense-in-depth layer for the browser's direct
-- anon-key access; the API scopes every query by currentUserId() regardless).
--
-- Unlike `notes` (unique per syllabus node, one canonical copy), a user can
-- save many notes and several may point at the same node, so there is NO
-- uniqueness on syllabus_node_id. The node link is INFERRED at save time and
-- editable by the user; it is nullable (a saved answer may not map cleanly to
-- one node). content_i18n may legitimately have only ONE locale populated (the
-- note is generated in the user's current locale); an optional on-demand
-- "translate" action fills the other side later — so there is no bilingual
-- gate here either.
-- ---------------------------------------------------------------------------

create table if not exists public.user_notes (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references public.users_profile(id) on delete cascade,
  -- Inferred (editable) syllabus node this note belongs to; null when it maps
  -- to no single node. Note survives the node being deleted.
  syllabus_node_id  uuid references public.syllabus_nodes(id) on delete set null,
  -- Provenance: the mentor thread + message this was distilled from. The note
  -- is independent study material, so deleting the conversation only nulls the
  -- back-reference (set null), never removes the saved note.
  source_thread_id  uuid references public.doubt_threads(id) on delete set null,
  source_message_id uuid references public.doubt_messages(id) on delete set null,
  title             text not null default '',
  -- Same shape as notes.content_i18n ({hi,en} NoteBody), but either locale's
  -- body may be the empty NoteBody until a translate action fills it.
  content_i18n      jsonb not null default '{}'::jsonb,
  -- Offered SRS cards (same shape as notes.srs_candidates) — never auto-added.
  srs_candidates    jsonb not null default '[]'::jsonb,
  meta              jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists user_notes_user_idx on public.user_notes (user_id, created_at desc);
create index if not exists user_notes_user_node_idx on public.user_notes (user_id, syllabus_node_id);

drop trigger if exists user_notes_set_updated_at on public.user_notes;
create trigger user_notes_set_updated_at
  before update on public.user_notes
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Strict owner-only RLS (mirrors the 0053 shape). Delete IS granted — the
-- reader/profile UI lets a user delete their own personal note.
-- ---------------------------------------------------------------------------
alter table public.user_notes enable row level security;

create policy owner_select on public.user_notes
  for select to authenticated using (auth.uid() = user_id);
create policy owner_insert on public.user_notes
  for insert to authenticated with check (auth.uid() = user_id);
create policy owner_update on public.user_notes
  for update to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy owner_delete on public.user_notes
  for delete to authenticated using (auth.uid() = user_id);

-- anon is read-only globally (0053 §revoke); no grant to anon here → fully
-- denied. authenticated gets the standard row-scoped access; service role
-- (the API) bypasses RLS.
grant select, insert, update, delete on public.user_notes to authenticated;
