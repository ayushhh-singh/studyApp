-- 0037_node_weightage_mv.sql
-- Cached weightage aggregates: how often each syllabus topic has been asked, by
-- exam and by year. This is the data behind the /learn weightage bars, the
-- per-question "asked 7x in 10 yrs · last 2023" chips, and the per-paper Trends
-- view. Computed once here and refreshed after each ingest (see
-- refresh_node_weightage()) rather than re-aggregated on every request.
--
-- Grain: one row per (syllabus_node_id, exam_code, year). Only REAL past-year
-- questions count toward weightage — published + approved + source='pyq'
-- (generated/CA MCQs are excluded; they are not exam frequency signal). The API
-- rolls these OWN-node counts up through the syllabus subtree, exactly like
-- pyq_count, so a chapter row reflects its descendants.

create materialized view public.mv_node_weightage as
  select
    q.syllabus_node_id as node_id,
    q.exam_code,
    q.year,
    count(*)::int      as q_count
  from public.questions q
  where q.syllabus_node_id is not null
    and q.year is not null
    and q.is_published
    and q.review_state = 'approved'
    and q.source = 'pyq'
  group by q.syllabus_node_id, q.exam_code, q.year;

-- Unique key required for REFRESH ... CONCURRENTLY (non-blocking refresh).
create unique index mv_node_weightage_key
  on public.mv_node_weightage (node_id, exam_code, year);
create index mv_node_weightage_node_idx on public.mv_node_weightage (node_id);

-- Grants mirror the other read surfaces (0015 default privileges only cover
-- tables/sequences, not matviews created later).
grant select on public.mv_node_weightage to anon, authenticated, service_role;

-- Refresh entry point. CONCURRENTLY so reads never block; falls back to a plain
-- refresh the first time (a matview with zero prior populate cannot refresh
-- concurrently). Called by ingest:pyq:load after a load and available as
-- `pnpm ingest:refresh-weightage`.
create or replace function public.refresh_node_weightage()
returns void
language plpgsql
as $$
begin
  refresh materialized view concurrently public.mv_node_weightage;
exception
  when others then
    -- e.g. first refresh after create, or a transient lock — do a blocking one.
    refresh materialized view public.mv_node_weightage;
end;
$$;
