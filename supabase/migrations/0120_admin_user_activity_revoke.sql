-- 0120_admin_user_activity_revoke.sql
-- Makes 0119's documented "service_role only" posture actually true.
--
-- ⚑ THE TRAP, worth knowing before adding ANY sensitive function to this schema:
-- `0015_api_role_grants.sql` runs
--     alter default privileges in schema public grant all on functions
--       to anon, authenticated, service_role;
-- so EVERY newly created function in `public` is automatically EXECUTE-able by
-- `anon` and `authenticated`. A `revoke all ... from public` (which 0119 did)
-- does NOT undo that: it revokes only the PUBLIC pseudo-role, never the two
-- explicit role grants the default privileges hand out. The only way to get a
-- service-role-only function is to revoke from those roles BY NAME.
--
-- MEASURED IMPACT OF THE GAP (verified live against the cloud DB before writing
-- this, rather than assumed): a bare anon call to admin_user_activity SUCCEEDED,
-- but every column came back zeroed — `last_active_at` NULL, both counts 0 —
-- because the function is SECURITY INVOKER (the default) and the five activity
-- tables it reads are owner-only under RLS (0053), so `auth.uid()` resolves to
-- nothing and no row qualifies. So NO DATA WAS EXPOSED, and an authenticated
-- caller could likewise only ever have reached its own rows.
--
-- WHY FIX IT ANYWAY: the whole value of the SECURITY INVOKER + RLS combination
-- here is defense in depth (the 0053 posture). The function currently leans
-- ENTIRELY on RLS while its own comment claims it is service-role-gated — so the
-- next person to make it `security definer` (a plausible optimisation, since the
-- API already calls it with the service role and pays for RLS it does not need)
-- would silently convert a documented-safe function into a full cross-user
-- activity leak, reachable by anyone holding the public anon key. Revoking now
-- means that future change fails closed instead.
--
-- Append-only rather than an edit to 0119: that migration is already applied and
-- its ledger row carries real statements, so editing it would create file-vs-
-- ledger drift. Same reason 0108 dropped 0107's redundant index in its own file.

revoke execute on function public.admin_user_activity(uuid[]) from anon, authenticated;

-- Assert the end state rather than claiming it: after this migration exactly one
-- role (service_role) may execute the function. A future `alter default
-- privileges` change or a re-grant that widens it again fails here loudly
-- instead of silently reopening the hole.
do $$
declare
  grantees text;
begin
  select coalesce(string_agg(distinct r.grantee, ',' order by r.grantee), '(none)')
    into grantees
  from information_schema.routine_privileges r
  join pg_proc p on p.proname = r.routine_name
  where r.routine_schema = 'public'
    and r.routine_name = 'admin_user_activity'
    and r.privilege_type = 'EXECUTE'
    and r.grantee in ('anon', 'authenticated', 'PUBLIC');
  if grantees <> '(none)' then
    raise exception
      'admin_user_activity is still EXECUTE-able by: % — it must be service_role only', grantees;
  end if;
end $$;
