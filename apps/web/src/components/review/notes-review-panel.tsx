import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { Check, ChevronLeft, ChevronRight, Inbox, Pencil, X, AlertTriangle } from "lucide-react";
import type { Locale, NoteBody, NoteContentI18n, ReviewNote } from "@neev/shared";
import { SectionCard } from "@/components/ui-x/section-card";
import { EmptyState } from "@/components/ui-x/empty-state";
import { Skeleton } from "@/components/ui-x/skeleton";
import { Button } from "@/components/ui/button";
import { useNoteApprove, useNoteEdit, useNoteReject, useReviewNotes } from "@/hooks/use-review-notes";
import { ChapterReview, isChapterNote } from "@/components/review/chapter-review";
import { queryKeys } from "@/lib/query-keys";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Read-only preview: meta + critic verdict + both-language blocks stacked.
// ---------------------------------------------------------------------------
function Bilingual({ label, hi, en }: { label: string; hi: string; en: string }) {
  if (!hi.trim() && !en.trim()) return null;
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
      {en.trim() && <p className="whitespace-pre-line text-sm leading-relaxed">{en}</p>}
      {hi.trim() && <p className="whitespace-pre-line text-sm leading-[1.9]" lang="hi">{hi}</p>}
    </div>
  );
}

function facts(body: NoteBody): string {
  return body.key_facts.map((f) => `• ${f.fact}`).join("\n");
}

function NoteReviewCard({ note }: { note: ReviewNote }) {
  const { t } = useTranslation();
  const hi = note.content_i18n.hi;
  const en = note.content_i18n.en;
  const critic = note.meta?.critic ?? null;
  const flags = critic?.factual_red_flags ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
          {note.paper_code ?? "—"}
        </span>
        <span className="text-sm font-semibold">{note.syllabus_title_i18n?.en ?? note.syllabus_node_id}</span>
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-xs font-medium",
            note.publish_gate_ok ? "bg-tulsi/15 text-tulsi-foreground" : "bg-coral/15 text-coral-foreground",
          )}
        >
          {note.publish_gate_ok ? t("ReviewNotes.gateOk") : t("ReviewNotes.gateFail")}
        </span>
        <span className="ms-auto text-xs text-muted-foreground">
          v{note.version} · {note.model ?? "?"} · ${note.cost_usd.toFixed(3)}
          {note.meta?.web_search_used ? ` · ${t("ReviewNotes.webGrounded")}` : ""}
        </span>
      </div>

      {critic && (
        <div
          className={cn(
            "flex flex-col gap-1 rounded-lg border px-3 py-2 text-xs",
            flags.length || critic.syllabus_drift
              ? "border-coral/30 bg-coral/[0.07]"
              : "border-tulsi/30 bg-tulsi/[0.07]",
          )}
        >
          <span className="flex items-center gap-1.5 font-semibold">
            {flags.length || critic.syllabus_drift ? (
              <AlertTriangle className="size-3.5 text-coral-foreground" />
            ) : (
              <Check className="size-3.5 text-tulsi-foreground" />
            )}
            {t("ReviewNotes.criticVerdict")}: {critic.approve ? t("ReviewNotes.clean") : t("ReviewNotes.flagged")}
          </span>
          {critic.syllabus_drift && <span>⚠ {t("ReviewNotes.syllabusDrift")}</span>}
          {flags.map((f, i) => (
            <span key={i}>• {f}</span>
          ))}
          {critic.notes && <span className="text-muted-foreground">{critic.notes}</span>}
        </div>
      )}

      <div className="flex flex-col gap-3 rounded-lg border border-border bg-background p-3">
        <Bilingual label={t("Notes.overview")} hi={hi.overview} en={en.overview} />
        <Bilingual label={t("Notes.keyFacts")} hi={facts(hi)} en={facts(en)} />
        <Bilingual label={t("Notes.upAngle")} hi={hi.up_angle} en={en.up_angle} />
        <Bilingual label={t("Notes.pyqAnalysis")} hi={hi.pyq_analysis} en={en.pyq_analysis} />
        <Bilingual label={t("Notes.quickRevision")} hi={hi.quick_revision.join("\n")} en={en.quick_revision.join("\n")} />
        {note.srs_candidates.length > 0 && (
          <span className="text-xs text-muted-foreground">
            {t("ReviewNotes.srsCount", { count: note.srs_candidates.length })}
          </span>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Block-level edit form (both languages).
// ---------------------------------------------------------------------------
type Draft = Record<Locale, {
  overview: string;
  key_facts: string; // one fact per line
  up_angle: string;
  pyq_analysis: string;
  mnemonics: string;
  quick_revision: string;
}>;

function bodyToDraft(b: NoteBody) {
  return {
    overview: b.overview,
    key_facts: b.key_facts.map((f) => f.fact).join("\n"),
    up_angle: b.up_angle,
    pyq_analysis: b.pyq_analysis,
    mnemonics: b.mnemonics.join("\n"),
    quick_revision: b.quick_revision.join("\n"),
  };
}

function lines(s: string): string[] {
  return s.split("\n").map((x) => x.trim()).filter(Boolean);
}

/** Rebuild a NoteBody, preserving each key fact's original source_ref by index. */
function draftToBody(orig: NoteBody, d: Draft[Locale]): NoteBody {
  const factLines = lines(d.key_facts);
  return {
    overview: d.overview.trim(),
    key_facts: factLines.map((fact, i) => ({ fact, source_ref: orig.key_facts[i]?.source_ref ?? null })),
    up_angle: d.up_angle.trim(),
    pyq_analysis: d.pyq_analysis.trim(),
    mnemonics: lines(d.mnemonics),
    quick_revision: lines(d.quick_revision),
    further_reading: orig.further_reading,
  };
}

function Field({
  label,
  hi,
  en,
  onHi,
  onEn,
  rows = 3,
}: {
  label: string;
  hi: string;
  en: string;
  onHi: (v: string) => void;
  onEn: (v: string) => void;
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

function NoteEditForm({
  note,
  pending,
  onSubmit,
  onCancel,
}: {
  note: ReviewNote;
  pending: boolean;
  onSubmit: (content: NoteContentI18n, approve: boolean) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<Draft>({
    hi: bodyToDraft(note.content_i18n.hi),
    en: bodyToDraft(note.content_i18n.en),
  });

  function set(loc: Locale, field: keyof Draft[Locale], v: string) {
    setDraft((d) => ({ ...d, [loc]: { ...d[loc], [field]: v } }));
  }

  function build(): NoteContentI18n {
    return {
      hi: draftToBody(note.content_i18n.hi, draft.hi),
      en: draftToBody(note.content_i18n.en, draft.en),
    };
  }

  // The publish gate the backend enforces: both overviews non-blank.
  const overviewOk = draft.hi.overview.trim().length > 0 && draft.en.overview.trim().length > 0;

  return (
    <div className="flex flex-col gap-4">
      <Field label={t("Notes.overview")} en={draft.en.overview} hi={draft.hi.overview} onEn={(v) => set("en", "overview", v)} onHi={(v) => set("hi", "overview", v)} rows={4} />
      <Field label={`${t("Notes.keyFacts")} (${t("ReviewNotes.onePerLine")})`} en={draft.en.key_facts} hi={draft.hi.key_facts} onEn={(v) => set("en", "key_facts", v)} onHi={(v) => set("hi", "key_facts", v)} rows={6} />
      <Field label={t("Notes.upAngle")} en={draft.en.up_angle} hi={draft.hi.up_angle} onEn={(v) => set("en", "up_angle", v)} onHi={(v) => set("hi", "up_angle", v)} rows={3} />
      <Field label={t("Notes.pyqAnalysis")} en={draft.en.pyq_analysis} hi={draft.hi.pyq_analysis} onEn={(v) => set("en", "pyq_analysis", v)} onHi={(v) => set("hi", "pyq_analysis", v)} rows={3} />
      <Field label={`${t("Notes.mnemonics")} (${t("ReviewNotes.onePerLine")})`} en={draft.en.mnemonics} hi={draft.hi.mnemonics} onEn={(v) => set("en", "mnemonics", v)} onHi={(v) => set("hi", "mnemonics", v)} rows={3} />
      <Field label={`${t("Notes.quickRevision")} (${t("ReviewNotes.onePerLine")})`} en={draft.en.quick_revision} hi={draft.hi.quick_revision} onEn={(v) => set("en", "quick_revision", v)} onHi={(v) => set("hi", "quick_revision", v)} rows={4} />

      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
        <Button
          type="button"
          onClick={() => onSubmit(build(), true)}
          disabled={pending || !overviewOk}
          className="bg-tulsi text-white hover:bg-tulsi/90"
        >
          <Check className="size-4" /> {t("ReviewNotes.saveApprove")}
        </Button>
        <Button type="button" variant="outline" onClick={() => onSubmit(build(), false)} disabled={pending}>
          {t("ReviewNotes.saveDraft")}
        </Button>
        {!overviewOk && <span className="text-xs text-coral-foreground">{t("ReviewNotes.gateFail")}</span>}
        <Button type="button" variant="ghost" onClick={onCancel} disabled={pending}>
          {t("Review.cancel")}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------
export function NotesReviewPanel() {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const [index, setIndex] = useState(0);
  const [editing, setEditing] = useState(false);
  const queryClient = useQueryClient();

  const queue = useReviewNotes(page, true);
  const items = useMemo(() => queue.data?.items ?? [], [queue.data]);
  const totalPages = queue.data?.pagination.total_pages ?? 1;
  const current = items[Math.min(index, Math.max(0, items.length - 1))];

  const approve = useNoteApprove();
  const reject = useNoteReject();
  const edit = useNoteEdit();
  const pending = approve.isPending || reject.isPending || edit.isPending;
  const actionError = (approve.error || reject.error || edit.error) as Error | null;

  const refresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["admin", "notes", "review"] });
    queryClient.invalidateQueries({ queryKey: queryKeys.reviewCounts() });
  }, [queryClient]);

  useEffect(() => {
    if (!queue.isFetching && items.length === 0 && page > 1) setPage((p) => p - 1);
  }, [queue.isFetching, items.length, page]);
  useEffect(() => {
    if (index > items.length - 1) setIndex(Math.max(0, items.length - 1));
  }, [items.length, index]);

  if (queue.isLoading) return <Skeleton className="h-72 w-full" />;
  if (items.length === 0) {
    return <EmptyState icon={Inbox} title={t("ReviewNotes.emptyTitle")} description={t("ReviewNotes.emptyDescription")} />;
  }
  if (!current) return null;

  return (
    <SectionCard>
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          {t("Review.position", { current: index + 1, total: items.length })}
          {totalPages > 1 && ` · ${t("Learn.pageOf", { page, total: totalPages })}`}
        </span>
        <div className="flex gap-1">
          {/* Disabled while editing — see the same fix + comment in routes/review.tsx. */}
          <Button type="button" variant="outline" size="icon-sm" aria-label={t("Review.prev")} disabled={index <= 0 || editing} onClick={() => setIndex((i) => Math.max(0, i - 1))}>
            <ChevronLeft className="size-4" />
          </Button>
          <Button type="button" variant="outline" size="icon-sm" aria-label={t("Review.next")} disabled={index >= items.length - 1 || editing} onClick={() => setIndex((i) => Math.min(items.length - 1, i + 1))}>
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </div>

      {actionError && (
        <div className="rounded-lg border border-coral/30 bg-coral/10 px-3 py-2 text-sm text-coral-foreground">
          {actionError.message}
        </div>
      )}

      {isChapterNote(current) ? (
        // Chapters (Session 28) own their whole review surface (fact-audit gate
        // + section-level edit); its internal edit mode reports up via
        // onEditingChange so the queue nav is disabled while editing, same as
        // the digest form. key={current.id} remounts if the queue shifts.
        <ChapterReview
          key={current.id}
          note={current}
          pending={pending}
          onEditingChange={setEditing}
          onSendBack={() => reject.mutate({ id: current.id }, { onSuccess: refresh })}
          onSave={(body, onDone) =>
            edit.mutate(
              { id: current.id, body },
              { onSuccess: () => { onDone?.(); refresh(); } },
            )
          }
        />
      ) : editing ? (
        // key={current.id}: forces a remount if `current` ever changes while
        // editing (e.g. a concurrent action elsewhere shrinks the queue and
        // the index-clamp effect above shifts `current`) — same fix as
        // routes/review.tsx's ReviewEditForm.
        <NoteEditForm
          key={current.id}
          note={current}
          pending={pending}
          onCancel={() => setEditing(false)}
          onSubmit={(content, doApprove) =>
            edit.mutate(
              { id: current.id, body: { content_i18n: content, approve: doApprove } },
              { onSuccess: () => { setEditing(false); refresh(); } },
            )
          }
        />
      ) : (
        <>
          <NoteReviewCard note={current} />
          <div className="flex flex-wrap gap-2 border-t border-border pt-4">
            <Button
              type="button"
              onClick={() => approve.mutate(current.id, { onSuccess: refresh })}
              disabled={pending || !current.publish_gate_ok}
              className="bg-tulsi text-white hover:bg-tulsi/90"
            >
              <Check className="size-4" /> {t("ReviewNotes.publish")}
            </Button>
            <Button type="button" variant="outline" onClick={() => setEditing(true)} disabled={pending}>
              <Pencil className="size-4" /> {t("Review.edit")}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => reject.mutate({ id: current.id }, { onSuccess: refresh })}
              disabled={pending}
              className="border-coral/40 text-coral-foreground hover:bg-coral/10"
            >
              <X className="size-4" /> {t("ReviewNotes.sendBack")}
            </Button>
          </div>
        </>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between border-t border-border pt-3">
          <Button type="button" variant="ghost" size="sm" disabled={page <= 1} onClick={() => { setPage((p) => p - 1); setIndex(0); }}>
            {t("Learn.prevPage")}
          </Button>
          <Button type="button" variant="ghost" size="sm" disabled={page >= totalPages} onClick={() => { setPage((p) => p + 1); setIndex(0); }}>
            {t("Learn.nextPage")}
          </Button>
        </div>
      )}
    </SectionCard>
  );
}
