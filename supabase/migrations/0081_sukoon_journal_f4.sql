-- Sukoon F4 (Journaling) — schema additions + pgcrypto encrypt/decrypt RPCs.
--
-- The journal is the MOST SENSITIVE data in Sukoon (blueprint F4 / SUKOON_CONTEXT):
-- entry bodies are stored ENCRYPTED AT REST (pgcrypto pgp_sym_encrypt) so raw
-- text is never casually readable in the Supabase dashboard, table exports, or
-- logs. The symmetric key lives ONLY in the API env (JOURNAL_ENC_KEY) — never in
-- the DB — and is bound as a bound parameter to these RPCs. Plaintext exists in
-- exactly two places: the user's own authenticated client (which legitimately
-- views their own journal) and transiently inside these SECURITY-scoped
-- functions. The list/search path NEVER decrypts (metadata only — see the
-- journal service), so bodies stay encrypted for every browse/filter operation.
--
-- pgcrypto was installed `with schema extensions` in 0078, so its functions are
-- schema-qualified as extensions.pgp_sym_encrypt / extensions.pgp_sym_decrypt
-- (the same non-search_path convention Neev uses for pgvector).
--
-- Applied to the cloud DB via `db push --db-url` — see [[supabase-headless-migrations]].

-- ---------------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------------

-- AI Reflections (F4, Plus+): a warm 2-3 sentence reflection on ONE entry, on
-- request. It's derived from (and echoes) the sensitive body, so it is encrypted
-- with the SAME key and only ever decrypted on the single-entry fetch path.
alter table public.sukoon_journal_entries
  add column if not exists reflection_enc bytea,
  add column if not exists reflection_at  timestamptz,
  add column if not exists updated_at      timestamptz not null default now();

-- Edits (rich-text-lite body, mood, tags) bump updated_at; the list orders by
-- created_at (entry date) but the editor uses updated_at to detect stale drafts.
drop trigger if exists sukoon_journal_entries_set_updated_at on public.sukoon_journal_entries;
create trigger sukoon_journal_entries_set_updated_at
  before update on public.sukoon_journal_entries
  for each row execute function public.sukoon_set_updated_at();

-- A stable seed key so the 60 guided prompts (0082) upsert idempotently and can
-- be edited/re-run without duplicating. NULL for any user-created prompt (none
-- today — prompts are seeded content only).
alter table public.sukoon_journal_prompts
  add column if not exists key text;
create unique index if not exists sukoon_journal_prompts_key_uidx
  on public.sukoon_journal_prompts (key)
  where key is not null;

-- ---------------------------------------------------------------------------
-- 2. Encrypt/decrypt RPCs (the ONLY code path that ever holds JOURNAL_ENC_KEY)
--
-- Every function takes p_user_id and enforces it in the WHERE clause — the API
-- calls with the SERVICE ROLE (bypasses RLS) so this owner-scoping is the real
-- guard against a wrong-id cross-user read, exactly mirroring the service-layer
-- `.eq("user_id", userId)` convention. SECURITY INVOKER (default): when the
-- service role calls them they run as the service role. Execute is REVOKED from
-- anon/authenticated (below) — the browser never has the key and never calls
-- these directly; all journal I/O goes through Express.
-- ---------------------------------------------------------------------------

-- Create: encrypts the body (NULL body -> NULL ciphertext, e.g. a mood-only or
-- voice-only entry) and returns the new id. Metadata is re-read by the caller.
create or replace function public.sukoon_journal_create(
  p_user_id   uuid,
  p_body      text,
  p_mood      smallint,
  p_tags      text[],
  p_prompt_id uuid,
  p_key       text
) returns uuid
language plpgsql
as $fn$
declare
  v_id uuid;
begin
  insert into public.sukoon_journal_entries (user_id, body_enc, mood, tags, prompt_id)
  values (
    p_user_id,
    case when p_body is null or p_body = '' then null
         else extensions.pgp_sym_encrypt(p_body, p_key) end,
    p_mood,
    coalesce(p_tags, '{}'),
    p_prompt_id
  )
  returning id into v_id;
  return v_id;
end;
$fn$;

-- Update: re-encrypts body, updates mood/tags. Scoped to the owner and to
-- non-deleted rows (a soft-deleted entry can't be silently resurrected by edit).
-- Returns the number of rows touched (0 => not found / not owner / deleted).
create or replace function public.sukoon_journal_update(
  p_user_id uuid,
  p_id      uuid,
  p_body    text,
  p_mood    smallint,
  p_tags    text[],
  p_key     text
) returns integer
language plpgsql
as $fn$
declare
  v_count integer;
begin
  update public.sukoon_journal_entries
  set body_enc = case when p_body is null or p_body = '' then null
                      else extensions.pgp_sym_encrypt(p_body, p_key) end,
      mood = p_mood,
      tags = coalesce(p_tags, '{}')
  where id = p_id and user_id = p_user_id and deleted_at is null;
  get diagnostics v_count = row_count;
  return v_count;
end;
$fn$;

-- Fetch ONE entry with body + reflection DECRYPTED — the only read that ever
-- decrypts. Owner-scoped, non-deleted.
create or replace function public.sukoon_journal_get(
  p_user_id uuid,
  p_id      uuid,
  p_key     text
) returns table (
  id            uuid,
  body          text,
  mood          smallint,
  tags          text[],
  prompt_id     uuid,
  audio_path    text,
  reflection    text,
  reflection_at timestamptz,
  created_at    timestamptz,
  updated_at    timestamptz
)
language sql
as $fn$
  select
    e.id,
    case when e.body_enc is null then null
         else extensions.pgp_sym_decrypt(e.body_enc, p_key) end,
    e.mood,
    e.tags,
    e.prompt_id,
    e.audio_path,
    case when e.reflection_enc is null then null
         else extensions.pgp_sym_decrypt(e.reflection_enc, p_key) end,
    e.reflection_at,
    e.created_at,
    e.updated_at
  from public.sukoon_journal_entries e
  where e.id = p_id and e.user_id = p_user_id and e.deleted_at is null;
$fn$;

-- Persist an AI reflection (encrypted) onto an entry. Owner-scoped, non-deleted.
create or replace function public.sukoon_journal_set_reflection(
  p_user_id    uuid,
  p_id         uuid,
  p_reflection text,
  p_key        text
) returns integer
language plpgsql
as $fn$
declare
  v_count integer;
begin
  update public.sukoon_journal_entries
  set reflection_enc = extensions.pgp_sym_encrypt(p_reflection, p_key),
      reflection_at  = now()
  where id = p_id and user_id = p_user_id and deleted_at is null;
  get diagnostics v_count = row_count;
  return v_count;
end;
$fn$;

-- Range export: decrypt many entries between two IST-day-bounded timestamps for
-- the PDF/print export (F4). Owner-scoped, non-deleted, chronological.
create or replace function public.sukoon_journal_export(
  p_user_id uuid,
  p_from    timestamptz,
  p_to      timestamptz,
  p_key     text
) returns table (
  id         uuid,
  body       text,
  mood       smallint,
  tags       text[],
  prompt_id  uuid,
  reflection text,
  created_at timestamptz
)
language sql
as $fn$
  select
    e.id,
    case when e.body_enc is null then null
         else extensions.pgp_sym_decrypt(e.body_enc, p_key) end,
    e.mood,
    e.tags,
    e.prompt_id,
    case when e.reflection_enc is null then null
         else extensions.pgp_sym_decrypt(e.reflection_enc, p_key) end,
    e.created_at
  from public.sukoon_journal_entries e
  where e.user_id = p_user_id
    and e.deleted_at is null
    and e.created_at >= p_from
    and e.created_at < p_to
  order by e.created_at asc;
$fn$;

-- Defense in depth: the browser (anon/authenticated) must never call these — it
-- has no key, and all journal I/O is proxied through the service-role API.
revoke all on function public.sukoon_journal_create(uuid, text, smallint, text[], uuid, text) from anon, authenticated;
revoke all on function public.sukoon_journal_update(uuid, uuid, text, smallint, text[], text) from anon, authenticated;
revoke all on function public.sukoon_journal_get(uuid, uuid, text) from anon, authenticated;
revoke all on function public.sukoon_journal_set_reflection(uuid, uuid, text, text) from anon, authenticated;
revoke all on function public.sukoon_journal_export(uuid, timestamptz, timestamptz, text) from anon, authenticated;
