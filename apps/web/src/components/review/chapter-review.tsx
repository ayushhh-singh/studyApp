import { useMemo, useState } from "react";
import { Check, Pencil, ShieldAlert, ShieldCheck, X } from "lucide-react";
import {
  hasChapter,
  unresolvedFlagCount,
  type AuditedFact,
  type ChapterSection,
  type FactAudit,
  type FactAuditStatus,
  type ReviewNote,
  type ReviewNoteEditBody,
  type StudyContent,
} from "@neev/shared";
import { Button } from "@/components/ui/button";
import { ChapterMarkdown } from "@/components/ui-x/chapter-markdown";
import { cn } from "@/lib/utils";

// Chapters (Session 28) get section-level review + a fact-audit gate ON TOP of
// the digest blocks. Admin-facing, so plain English labels (matching the digest
// panel's convention) rather than i18n keys.

// ---------------------------------------------------------------------------
// Small stacked EN/HI display — mirrors NotesReviewPanel's `Bilingual`.
// ---------------------------------------------------------------------------
function BilingualBlock({ label, en, hi }: { label?: string; en: string; hi: string }) {
  if (!en.trim() && !hi.trim()) return null;
  return (
    <div className="flex flex-col gap-1">
      {label && <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>}
      {en.trim() && <p className="whitespace-pre-line text-sm leading-relaxed">{en}</p>}
      {hi.trim() && (
        <p className="whitespace-pre-line text-sm leading-[1.9]" lang="hi">
          {hi}
        </p>
      )}
    </div>
  );
}

function EnHiField({
  label,
  en,
  hi,
  onEn,
  onHi,
  rows = 3,
}: {
  label: string;
  en: string;
  hi: string;
  onEn: (v: string) => void;
  onHi: (v: string) => void;
  rows?: number;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
      <div className="grid gap-2 sm:grid-cols-2">
        <textarea
          value={en}
          onChange={(e) => onEn(e.target.value)}
          rows={rows}
          placeholder="English"
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <textarea
          value={hi}
          onChange={(e) => onHi(e.target.value)}
          rows={rows}
          placeholder="हिन्दी"
          lang="hi"
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm leading-[1.9] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>
    </div>
  );
}

function humanizeKind(kind: string): string {
  return kind.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

function wordCount(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

/** Recompute the audit summary from the facts so it never drifts from reviewer edits. */
function withSummary(fa: FactAudit): FactAudit {
  const summary = { verified: 0, flagged: 0, unverifiable: 0 };
  for (const f of fa.facts) summary[f.status] += 1;
  return { ...fa, summary };
}

// ---------------------------------------------------------------------------
// Fact-audit panel — the publish gate. Resolve toggles mutate local state.
// ---------------------------------------------------------------------------
const STATUS_BADGE: Record<FactAuditStatus, string> = {
  verified: "bg-tulsi/15 text-tulsi-foreground",
  flagged: "bg-coral/15 text-coral-foreground",
  unverifiable: "bg-marigold/15 text-marigold-foreground",
};

function FactAuditPanel({
  factAudit,
  sectionHeadings,
  onToggleResolved,
}: {
  factAudit: FactAudit;
  sectionHeadings: Map<string, string>;
  onToggleResolved: (id: string) => void;
}) {
  const summary = useMemo(() => {
    const s = { verified: 0, flagged: 0, unverifiable: 0 };
    for (const f of factAudit.facts) s[f.status] += 1;
    return s;
  }, [factAudit.facts]);

  const unresolved = unresolvedFlagCount(factAudit);
  const clean = summary.flagged === 0 && summary.unverifiable === 0;

  // Flagged + unverifiable first (unresolved-first within that), then verified.
  const sorted = useMemo(() => {
    const rank = (f: AuditedFact) => (f.status === "verified" ? 2 : f.resolved ? 1 : 0);
    return [...factAudit.facts].sort((a, b) => rank(a) - rank(b));
  }, [factAudit.facts]);

  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-lg border px-3 py-3",
        clean ? "border-tulsi/30 bg-tulsi/[0.06]" : "border-coral/30 bg-coral/[0.06]",
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        {clean ? (
          <ShieldCheck className="size-4 text-tulsi-foreground" />
        ) : (
          <ShieldAlert className="size-4 text-coral-foreground" />
        )}
        <span className="text-sm font-semibold">Fact audit</span>
        <span className={cn("text-sm", clean ? "text-tulsi-foreground" : "text-coral-foreground")}>
          {summary.verified} verified · {summary.flagged} flagged · {summary.unverifiable} unverifiable
        </span>
        {factAudit.model && <span className="ms-auto text-xs text-muted-foreground">{factAudit.model}</span>}
      </div>

      {unresolved > 0 && (
        <p className="rounded-md bg-coral/10 px-2 py-1 text-xs font-medium text-coral-foreground">
          {unresolved} decisive fact{unresolved === 1 ? "" : "s"} still need resolution before this chapter can publish.
        </p>
      )}

      <ul className="flex flex-col gap-2">
        {sorted.map((f) => {
          const heading = sectionHeadings.get(f.section_id) ?? f.section_id;
          const resolved = f.resolved;
          return (
            <li
              key={f.id}
              className={cn(
                "flex flex-col gap-1 rounded-md border border-border bg-background px-2.5 py-2",
                resolved && "opacity-70",
              )}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className={cn("rounded-full px-2 py-0.5 text-[0.7rem] font-medium", STATUS_BADGE[f.status])}>
                  {f.status}
                </span>
                <span
                  className={cn(
                    "text-sm font-medium",
                    resolved && "text-tulsi-foreground line-through",
                  )}
                >
                  {f.claim}
                </span>
                {f.status !== "verified" && (
                  <button
                    type="button"
                    onClick={() => onToggleResolved(f.id)}
                    className={cn(
                      "ms-auto inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium transition-colors",
                      resolved
                        ? "border-tulsi/40 bg-tulsi/15 text-tulsi-foreground"
                        : "border-border text-muted-foreground hover:bg-muted",
                    )}
                  >
                    <Check className="size-3" /> {resolved ? "Resolved" : "Mark resolved"}
                  </button>
                )}
              </div>
              {f.evidence.trim() && <p className="text-xs text-muted-foreground">{f.evidence}</p>}
              <div className="flex flex-wrap gap-x-3 text-[0.7rem] text-muted-foreground">
                <span>§ {heading}</span>
                {f.source_ref && <span>source: {f.source_ref}</span>}
              </div>
            </li>
          );
        })}
        {sorted.length === 0 && <li className="text-xs text-muted-foreground">No decisive facts recorded.</li>}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section read view
// ---------------------------------------------------------------------------
function SectionRead({
  section,
  sources,
  flagged,
}: {
  section: ChapterSection;
  sources: ReviewNote["sources"];
  flagged: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-lg border-s-2 border-border bg-background p-3 ps-3",
        flagged && "border-s-coral",
      )}
    >
      <div className="flex flex-col gap-0.5">
        <h4 className="text-sm font-semibold">{section.heading_i18n.en}</h4>
        <h4 className="text-sm font-semibold text-muted-foreground" lang="hi">
          {section.heading_i18n.hi}
        </h4>
      </div>

      <div className="flex flex-col gap-2">
        <ChapterMarkdown content={section.body_md_i18n.en} locale="en" sources={sources} />
        <div className="border-t border-border/60 pt-2">
          <ChapterMarkdown content={section.body_md_i18n.hi} locale="hi" sources={sources} />
        </div>
      </div>

      {section.boxes.map((box, i) => (
        <div key={i} className="rounded-md border border-border/70 bg-muted/40 p-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-primary">{humanizeKind(box.kind)}</span>
          <div className="mt-1 flex flex-col gap-1">
            <ChapterMarkdown content={box.content_i18n.en} locale="en" sources={sources} />
            <ChapterMarkdown content={box.content_i18n.hi} locale="hi" sources={sources} />
          </div>
        </div>
      ))}

      {section.diagram && (
        <div className="rounded-md border border-border/70 bg-muted/40 p-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Diagram ({section.diagram.kind})
          </span>
          {section.diagram.caption_i18n && (
            <p className="mt-0.5 text-xs text-muted-foreground">{section.diagram.caption_i18n.en}</p>
          )}
          {section.diagram.kind === "table" ? (
            <div className="mt-1">
              <ChapterMarkdown content={section.diagram.source_i18n.en} locale="en" />
            </div>
          ) : (
            <pre className="mt-1 overflow-x-auto rounded bg-background p-2 text-xs">
              {section.diagram.source_i18n.en}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section edit form (heading + body + box contents, both languages)
// ---------------------------------------------------------------------------
type BoxDraft = { en: string; hi: string };
type SectionDraft = { headingEn: string; headingHi: string; bodyEn: string; bodyHi: string; boxes: BoxDraft[] };

function toSectionDraft(s: ChapterSection): SectionDraft {
  return {
    headingEn: s.heading_i18n.en,
    headingHi: s.heading_i18n.hi,
    bodyEn: s.body_md_i18n.en,
    bodyHi: s.body_md_i18n.hi,
    boxes: s.boxes.map((b) => ({ en: b.content_i18n.en, hi: b.content_i18n.hi })),
  };
}

/** Rebuild the full StudyContent from drafts, preserving ids / diagrams / pyq_ids / box kinds. */
function buildStudyContent(orig: StudyContent, drafts: SectionDraft[]): StudyContent {
  const sections = orig.sections.map((s, i) => {
    const d = drafts[i];
    return {
      ...s,
      heading_i18n: { en: d.headingEn.trim(), hi: d.headingHi.trim() },
      body_md_i18n: { en: d.bodyEn, hi: d.bodyHi },
      boxes: s.boxes.map((b, j) => ({ ...b, content_i18n: { en: d.boxes[j].en, hi: d.boxes[j].hi } })),
    };
  });
  return {
    sections,
    toc: sections.map((s) => ({ id: s.id, heading_i18n: s.heading_i18n })),
    est_read_minutes: orig.est_read_minutes,
    word_count: sections.reduce((n, s) => n + wordCount(s.body_md_i18n.en), 0),
  };
}

// ---------------------------------------------------------------------------
// ChapterReview — self-contained review surface for a chapter note.
// ---------------------------------------------------------------------------
export function ChapterReview({
  note,
  pending,
  onSave,
  onSendBack,
  onEditingChange,
}: {
  note: ReviewNote;
  pending: boolean;
  /** Persist an edit body (full replacements) + optionally publish. */
  onSave: (body: ReviewNoteEditBody, onDone?: () => void) => void;
  onSendBack: () => void;
  onEditingChange?: (editing: boolean) => void;
}) {
  const study = note.study_content_i18n;
  const [factAudit, setFactAudit] = useState<FactAudit>(note.fact_audit);
  const [editing, setEditingState] = useState(false);
  const [drafts, setDrafts] = useState<SectionDraft[]>(() => study.sections.map(toSectionDraft));

  const setEditing = (v: boolean) => {
    setEditingState(v);
    onEditingChange?.(v);
  };

  const sectionHeadings = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of study.sections) m.set(s.id, s.heading_i18n.en || s.heading_i18n.hi || s.id);
    return m;
  }, [study.sections]);

  // Sections carrying an unresolved flagged/unverifiable fact (live off local audit).
  const flaggedSections = useMemo(() => {
    const set = new Set<string>();
    for (const f of factAudit.facts) {
      if (f.status !== "verified" && !f.resolved) set.add(f.section_id);
    }
    return set;
  }, [factAudit.facts]);

  const unresolved = unresolvedFlagCount(factAudit);
  const publishBlocked = unresolved > 0 || !note.publish_gate_ok;
  const blockReason = !note.publish_gate_ok
    ? "Missing bilingual overview"
    : unresolved > 0
      ? `Resolve ${unresolved} flagged fact${unresolved === 1 ? "" : "s"} first`
      : "";

  function toggleResolved(id: string) {
    setFactAudit((fa) => ({
      ...fa,
      facts: fa.facts.map((f) => (f.id === id ? { ...f, resolved: !f.resolved } : f)),
    }));
  }

  function setDraft(idx: number, patch: Partial<SectionDraft>) {
    setDrafts((ds) => ds.map((d, i) => (i === idx ? { ...d, ...patch } : d)));
  }
  function setBoxDraft(sIdx: number, bIdx: number, patch: Partial<BoxDraft>) {
    setDrafts((ds) =>
      ds.map((d, i) =>
        i === sIdx ? { ...d, boxes: d.boxes.map((b, j) => (j === bIdx ? { ...b, ...patch } : b)) } : d,
      ),
    );
  }

  /** Body sent on save: current audit resolutions + (when editing) the section edits. */
  function buildBody(approve: boolean): ReviewNoteEditBody {
    const body: ReviewNoteEditBody = { fact_audit: withSummary(factAudit), approve };
    if (editing) body.study_content_i18n = buildStudyContent(study, drafts);
    return body;
  }

  // --- Edit mode -----------------------------------------------------------
  if (editing) {
    return (
      <div className="flex flex-col gap-4">
        <FactAuditPanel factAudit={factAudit} sectionHeadings={sectionHeadings} onToggleResolved={toggleResolved} />

        {study.sections.map((s, i) => (
          <div key={s.id} className="flex flex-col gap-3 rounded-lg border border-border p-3">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Section {i + 1}
            </span>
            <EnHiField
              label="Heading"
              en={drafts[i].headingEn}
              hi={drafts[i].headingHi}
              onEn={(v) => setDraft(i, { headingEn: v })}
              onHi={(v) => setDraft(i, { headingHi: v })}
              rows={1}
            />
            <EnHiField
              label="Body (markdown)"
              en={drafts[i].bodyEn}
              hi={drafts[i].bodyHi}
              onEn={(v) => setDraft(i, { bodyEn: v })}
              onHi={(v) => setDraft(i, { bodyHi: v })}
              rows={8}
            />
            {s.boxes.map((box, j) => (
              <EnHiField
                key={j}
                label={`Box: ${humanizeKind(box.kind)}`}
                en={drafts[i].boxes[j].en}
                hi={drafts[i].boxes[j].hi}
                onEn={(v) => setBoxDraft(i, j, { en: v })}
                onHi={(v) => setBoxDraft(i, j, { hi: v })}
                rows={3}
              />
            ))}
          </div>
        ))}

        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
          <Button
            type="button"
            disabled={pending || publishBlocked}
            onClick={() => onSave(buildBody(true), () => setEditing(false))}
            className="bg-tulsi text-white hover:bg-tulsi/90"
          >
            <Check className="size-4" /> Save &amp; publish
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() => onSave(buildBody(false), () => setEditing(false))}
          >
            Save draft
          </Button>
          {publishBlocked && <span className="text-xs text-coral-foreground">{blockReason}</span>}
          <Button type="button" variant="ghost" disabled={pending} onClick={() => setEditing(false)}>
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  // --- Read mode -----------------------------------------------------------
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
          {note.paper_code ?? "—"}
        </span>
        <span className="text-sm font-semibold">{note.syllabus_title_i18n?.en ?? note.syllabus_node_id}</span>
        <span className="rounded-full bg-marigold/15 px-2 py-0.5 text-xs font-medium text-marigold-foreground">
          Chapter v{note.chapter_version}
        </span>
        <span className="ms-auto text-xs text-muted-foreground">
          {study.sections.length} sections · {study.word_count} words · ~{study.est_read_minutes} min
        </span>
      </div>

      <FactAuditPanel factAudit={factAudit} sectionHeadings={sectionHeadings} onToggleResolved={toggleResolved} />

      <div className="flex flex-col gap-3">
        {study.sections.map((s) => (
          <SectionRead key={s.id} section={s} sources={note.sources} flagged={flaggedSections.has(s.id)} />
        ))}
      </div>

      {/* Digest / Quick Revision layer (read-only preview here; edit via Edit). */}
      <div className="flex flex-col gap-3 rounded-lg border border-dashed border-border bg-background p-3">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Quick Revision (digest)
        </span>
        <BilingualBlock label="Overview" en={note.content_i18n.en.overview} hi={note.content_i18n.hi.overview} />
        <BilingualBlock
          label="Quick revision"
          en={note.content_i18n.en.quick_revision.join("\n")}
          hi={note.content_i18n.hi.quick_revision.join("\n")}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
        <Button
          type="button"
          disabled={pending || publishBlocked}
          onClick={() => onSave(buildBody(true))}
          className="bg-tulsi text-white hover:bg-tulsi/90"
        >
          <Check className="size-4" /> Publish
        </Button>
        <Button type="button" variant="outline" disabled={pending} onClick={() => onSave(buildBody(false))}>
          Save resolutions
        </Button>
        <Button type="button" variant="outline" disabled={pending} onClick={() => setEditing(true)}>
          <Pencil className="size-4" /> Edit
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onClick={onSendBack}
          className="border-coral/40 text-coral-foreground hover:bg-coral/10"
        >
          <X className="size-4" /> Send back
        </Button>
        {publishBlocked && <span className="text-xs text-coral-foreground">{blockReason}</span>}
      </div>
    </div>
  );
}

/** True iff the note carries a real study chapter (drives the panel's render branch). */
export function isChapterNote(note: ReviewNote): boolean {
  return note.chapter_version > 0 || hasChapter(note.study_content_i18n);
}
