-- 0015_api_role_grants.sql
-- Grant table/sequence/function privileges to the Supabase API roles.
--
-- PostgREST executes requests as anon / authenticated / service_role. Tables
-- created over the direct `db push` connection do NOT automatically receive
-- Supabase's default API grants, so without this every REST call 403s with
-- Postgres error 42501 (insufficient_privilege). RLS still governs *row* access
-- (permissive dev policies in 0013 for now); these grants govern *table* access.
--
-- AUTH PHASE (Session 15): keep service_role + authenticated grants, but REVOKE
-- the broad write grants from `anon` (anon should be read-only / policy-gated).

grant usage on schema public to anon, authenticated, service_role;

grant all on all tables    in schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to anon, authenticated, service_role;
grant all on all functions in schema public to anon, authenticated, service_role;

-- Ensure objects created by future migrations inherit the same grants.
alter default privileges in schema public
  grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on functions to anon, authenticated, service_role;
