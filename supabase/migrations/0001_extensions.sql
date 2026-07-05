-- 0001_extensions.sql
-- Required Postgres extensions.
-- On Supabase these live in the dedicated `extensions` schema (already on the
-- default search_path). We schema-qualify vector types/opclasses everywhere to
-- be robust regardless of the session search_path.

create extension if not exists pgcrypto with schema extensions;
create extension if not exists vector with schema extensions;
