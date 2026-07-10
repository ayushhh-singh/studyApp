-- 0072_note_chapters.sql
-- Session 28 — Study Material Engine: upgrade notes from revision digests into
-- genuine, verified STUDY CHAPTERS. A chapter is the long-form, section-based,
-- fact-audited study material for a high-weightage node; it becomes the
-- highest-quality RAG grounding in the system (re-embedded per section).
--
-- The existing compact blocks (`content_i18n`, the NoteBody set) are UNTOUCHED —
-- they stay as the Quick Revision layer. This migration is purely additive:
--
--   study_content_i18n  the chapter itself (sections / boxes / diagrams / toc)
--   fact_audit          the Session-27-style decisive-fact verification report
--   chapter_version     bumped on each chapter (re)generation; 0 = digest-only
--
-- All three default to an "empty chapter" so every existing note keeps working
-- as a digest with no chapter (chapter_version = 0). A note is a "chapter" iff
-- study_content_i18n -> 'sections' is a non-empty array.

alter table public.notes
  -- Chapter body. Shape (validated by zod, packages/shared/src/notes.ts
  -- studyContentSchema):
  --   { sections: [{ id, heading_i18n:{hi,en}, body_md_i18n:{hi,en} (markdown),
  --                  boxes:[{ kind, content_i18n:{hi,en}, pyq_ids:[uuid] }],
  --                  diagram?:{ kind:'mermaid'|'table', source_i18n:{hi,en}, caption_i18n? },
  --                  pyq_ids:[uuid] }],
  --     toc:[{ id, heading_i18n }], est_read_minutes, word_count }
  add column if not exists study_content_i18n jsonb not null default '{}'::jsonb,

  -- Fact-audit report (Session 27 pattern). Every DECISIVE fact (article, date,
  -- name, number) extracted from the chapter, each verified against retrieved
  -- context or web_search:
  --   { facts:[{ id, section_id, claim, status:'verified'|'flagged'|'unverifiable',
  --              source_ref:string|null, evidence, resolved:bool }],
  --     summary:{ verified, flagged, unverifiable }, audited_at, model }
  -- Publish gate (enforced in services/notes.ts approveNote, mirroring the
  -- overviewComplete gate): a chapter with ANY unresolved flagged/unverifiable
  -- decisive fact cannot publish.
  add column if not exists fact_audit jsonb not null default '{}'::jsonb,

  -- Chapter generation counter, distinct from `version` (the digest counter).
  -- 0 → this note is a Quick-Revision digest only, no chapter.
  add column if not exists chapter_version int not null default 0;

comment on column public.notes.study_content_i18n is
  'Session 28 chapter: section-based bilingual study material (markdown bodies, boxes, diagrams, toc). Empty {} for digest-only notes.';
comment on column public.notes.fact_audit is
  'Session 28 fact-audit report: every decisive fact verified against context/web_search. Unresolved flags block publish (services/notes.ts).';
comment on column public.notes.chapter_version is
  'Chapter (re)generation counter; 0 = digest-only (no chapter). Distinct from version (digest counter).';

-- Partial index for the /learn coverage query ("how many nodes have a real
-- chapter, not just a digest"): a published note with a non-empty sections array.
create index if not exists notes_published_chapter_idx
  on public.notes (syllabus_node_id)
  where status = 'published'
    and jsonb_array_length(coalesce(study_content_i18n -> 'sections', '[]'::jsonb)) > 0;
