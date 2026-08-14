-- =============================================================================
-- 0131_admin_grant_action_max.sql — teach the admin audit trail about Max.
--
-- `admin_grant_action` (0117) is a Postgres ENUM, and it was never extended when
-- the Max tier landed. `services/admin-users.ts` writes 'grant_max'/'revoke_max',
-- so every Max grant or revoke from the admin UI failed with 22P02
-- "invalid input value for enum admin_grant_action".
--
-- ⚑ AND IT FAILED HALFWAY. grantPlan() updates users_profile FIRST and writes
-- the audit row SECOND, with no transaction between them (two separate
-- PostgREST calls). So the user really was moved to Max, the admin saw a 500
-- and a stale badge, and `admin_grants` — the entire reason that table exists —
-- recorded nothing. The admin then retries against stale state, forever, while
-- the grant has in fact already applied. Revoking a Max user was the mirror
-- image: dropped to free, told it failed, unaudited.
--
-- This is the class of defect a typecheck cannot see: the TypeScript enum
-- (`adminGrantActionSchema`) and the Postgres enum are two independent
-- declarations of the same set, and only one of them was updated.
--
-- Its own migration with nothing that USES the new values, per the repo's
-- convention (0040, 0046, 0129) — Postgres refuses to reference an uncommitted
-- enum value in the transaction that added it.
-- =============================================================================

alter type admin_grant_action add value if not exists 'grant_max';
alter type admin_grant_action add value if not exists 'revoke_max';

-- ---------------------------------------------------------------------------
-- Schema assertion, not a data one — true on first apply AND on every replay
-- (the M14 lesson from 0116, and from 0130's own first draft in this series).
-- ---------------------------------------------------------------------------
do $$
declare
  missing text;
begin
  select string_agg(v, ', ') into missing
    from unnest(array['grant_max', 'revoke_max']) as v
   where not exists (
     select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
      where t.typname = 'admin_grant_action' and e.enumlabel = v
   );
  if missing is not null then
    raise exception '0131: admin_grant_action is missing: %', missing;
  end if;
end $$;
