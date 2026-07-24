-- Sukoon F4 — actually lock down the journal encrypt/decrypt RPCs to the
-- service role only. 0081 revoked EXECUTE from anon/authenticated, but every
-- function also grants EXECUTE to PUBLIC on creation (and anon/authenticated are
-- members of PUBLIC), so they could still invoke these. This revokes PUBLIC too
-- and re-grants the service role explicitly.
--
-- NOTE this is defense in depth, not the primary guard: the data is already safe
-- because (a) JOURNAL_ENC_KEY lives only in the API env — the browser never has
-- it, so even an invocable RPC can't decrypt — and (b) RLS (0079) scopes the
-- underlying table to the owner. This just makes the "browser can't call these"
-- claim actually true.

do $$
declare
  sig text;
begin
  foreach sig in array array[
    'public.sukoon_journal_create(uuid, text, smallint, text[], uuid, text)',
    'public.sukoon_journal_update(uuid, uuid, text, smallint, text[], text)',
    'public.sukoon_journal_get(uuid, uuid, text)',
    'public.sukoon_journal_set_reflection(uuid, uuid, text, text)',
    'public.sukoon_journal_export(uuid, timestamptz, timestamptz, text)'
  ]
  loop
    execute format('revoke all on function %s from public, anon, authenticated', sig);
    execute format('grant execute on function %s to service_role', sig);
  end loop;
end $$;
