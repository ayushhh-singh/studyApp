-- 0065_current_affairs_exam_relevance.sql
-- Re-engineer current_affairs_items around EXAM RELEVANCE (PT-365 / Mains-365
-- style): every item has a separate prelims life (boxed facts) and mains life
-- (an issue to analyze). The pipeline scores each 0-3 and hard-gates anything
-- scoring < 2 on both to status='archived'.
--
-- All additive except the category taxonomy tightening + the status column that
-- subsumes is_published (now a generated column). See apps/api/src/ca/.

-- ---------------------------------------------------------------------------
-- 1. Exam-relevance scores + which Mains papers the item feeds.
-- ---------------------------------------------------------------------------
alter table public.current_affairs_items
  add column prelims_relevance smallint check (prelims_relevance between 0 and 3),
  add column mains_relevance   smallint check (mains_relevance between 0 and 3),
  add column gs_papers         text[] not null default '{}'::text[];

-- ---------------------------------------------------------------------------
-- 2. The two lives + suggested questions + per-node significance lines.
--    prelims_facts : [{fact_i18n, kind, extras:{ministry?,publisher?,rank?,location?}}]
--    mains_brief   : {why_in_news_i18n, background_i18n, significance_i18n[],
--                     challenges_i18n[], way_forward_i18n[], keywords_i18n[],
--                     case_examples_i18n[]}
--    possible_questions : {prelims_i18n?, mains_i18n?}
--    node_significance  : { <node_id>: {prelims_i18n?, mains_i18n?} }
-- ---------------------------------------------------------------------------
alter table public.current_affairs_items
  add column prelims_facts      jsonb,
  add column mains_brief        jsonb,
  add column possible_questions jsonb,
  add column node_significance  jsonb;

-- ---------------------------------------------------------------------------
-- 3. status: draft | published | archived. Replaces the is_published boolean as
--    the source of truth — is_published is re-created as a GENERATED column so
--    every existing reader (`.eq("is_published", true)`) keeps working unchanged
--    and archived items are automatically hidden everywhere, with zero drift.
-- ---------------------------------------------------------------------------
alter table public.current_affairs_items
  add column status text not null default 'draft'
    check (status in ('draft', 'published', 'archived'));

-- Backfill status from the existing boolean before swapping it for a generated one.
update public.current_affairs_items
  set status = case when is_published then 'published' else 'draft' end;

-- 0053's content_read RLS policy references is_published; drop it, swap the
-- column, then recreate the policy against the generated column.
drop policy if exists content_read on public.current_affairs_items;

alter table public.current_affairs_items drop column is_published;
alter table public.current_affairs_items
  add column is_published boolean generated always as (status = 'published') stored;

create policy content_read on public.current_affairs_items
  for select to anon, authenticated using (is_published);

-- ---------------------------------------------------------------------------
-- 4. Constrain the category taxonomy to the fixed 12-value set. Existing rows
--    carry the OLD free-text values; map them to the nearest new value so the
--    NOT-NULL-safe check can be validated immediately. The backfill
--    (pnpm ca:backfill) re-classifies every published item precisely afterward,
--    so this mapping only has to be constraint-valid, not perfect.
-- ---------------------------------------------------------------------------
update public.current_affairs_items set category = case category
  when 'polity_governance'   then 'polity_governance'
  when 'economy'             then 'economy'
  when 'environment_ecology' then 'environment_ecology'
  when 'science_tech'        then 'science_tech'
  when 'schemes_welfare'     then 'schemes'
  when 'up_state_affairs'    then 'up_special'
  when 'international'        then 'international_relations'
  when 'national'            then 'polity_governance'
  when 'awards_sports_misc'  then 'places_persons'
  else category
end
where category is not null;

-- Any legacy value we didn't anticipate → null (rather than fail the check);
-- backfill re-classifies it.
update public.current_affairs_items
  set category = null
  where category is not null and category not in (
    'polity_governance','economy','international_relations','environment_ecology',
    'science_tech','security','social_issues','art_culture','schemes',
    'reports_indices','places_persons','up_special'
  );

alter table public.current_affairs_items
  add constraint current_affairs_category_check
  check (category is null or category in (
    'polity_governance','economy','international_relations','environment_ecology',
    'science_tech','security','social_issues','art_culture','schemes',
    'reports_indices','places_persons','up_special'
  ));

-- ---------------------------------------------------------------------------
-- 5. Indexes for the exam-lens filters (prelims/mains/up tabs).
-- ---------------------------------------------------------------------------
create index current_affairs_prelims_rel_idx on public.current_affairs_items(prelims_relevance)
  where prelims_relevance is not null;
create index current_affairs_mains_rel_idx on public.current_affairs_items(mains_relevance)
  where mains_relevance is not null;
create index current_affairs_status_idx on public.current_affairs_items(status);
